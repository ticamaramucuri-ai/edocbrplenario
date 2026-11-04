#!/usr/bin/env python3
"""Verificação remota de saúde: host ausente, relógio divergente e caminho feliz.

Usa servidores HTTP falsos nesta máquina — o ensaio contra host real é passo da
trilha B e depende de host separado, que não existe hoje.
"""
from email.utils import formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/staging-remote-check.py'


def run(*args: str, esperado: int = 0):
    resultado = subprocess.run(['python3', '-I', str(SCRIPT), *args],
                               capture_output=True, text=True)
    if resultado.returncode != esperado:
        raise AssertionError(f'esperava saída {esperado}, veio {resultado.returncode}:\n'
                             f'{resultado.stdout}\n{resultado.stderr}')
    return resultado


def servidor(rotas: dict[str, tuple[int, dict]], desvio_de_relogio: float = 0.0):
    """Servidor falso: mapa caminho → (status, corpo JSON)."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - assinatura da biblioteca padrão
            caminho = self.path.split('?')[0]
            if caminho not in rotas:
                self.send_response_only(404)
                self.send_header('Date', formatdate(time.time() + desvio_de_relogio, usegmt=True))
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            status, corpo = rotas[caminho]
            dados = json.dumps(corpo).encode()
            self.send_response_only(status)
            self.send_header('Date', formatdate(time.time() + desvio_de_relogio, usegmt=True))
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(dados)))
            self.end_headers()
            self.wfile.write(dados)

        def log_message(self, *_):
            pass

    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}'


# ─── 1. Host inexistente: saída 2 e o serviço ausente nomeado ────────────────
falha = run('--base-url', 'http://127.0.0.1:1', '--expect-services', 'app,realtime',
            esperado=2)
saida = falha.stdout + falha.stderr
assert 'app' in saida, saida
assert 'realtime' in saida, saida
assert 'inacess' in saida.lower() or 'ausente' in saida.lower(), saida

# ─── 2. App de pé e um serviço esperado sem URL: ainda saída 2 ───────────────
app, url_app = servidor({
    '/api/v1/bootstrap': (200, {'tenant': {'slug': 'staging-example'}}),
    '/api/v1/health': (200, {'ok': True, 'version': 'test-revision'}),
})
try:
    falha = run('--base-url', url_app, '--expect-services', 'app,webhooks', esperado=2)
    saida = falha.stdout + falha.stderr
    assert 'webhooks' in saida, saida

    # ─── 3. Caminho feliz: app + dois serviços respondem ────────────────────
    rt, url_rt = servidor({'/health': (200, {'ok': True, 'version': 'test-revision', 'service': 'legis-realtime',
                                             'uptimeSeconds': 10})})
    wh, url_wh = servidor({'/health': (200, {'ok': True, 'version': 'test-revision', 'service': 'legis-webhooks',
                                             'uptimeSeconds': 10})})
    try:
        with tempfile.TemporaryDirectory() as pasta:
            prova = Path(pasta) / 'prova.json'
            ok = run('--base-url', url_app, '--expect-services', 'app,realtime,webhooks',
                     '--service', f'realtime={url_rt}', '--service', f'webhooks={url_wh}',
                     '--output', str(prova))
            corpo = json.loads(ok.stdout)
            assert corpo['ok'] is True, corpo
            assert corpo['remoto'] is False, 'alvo em loopback não é remoto'
            assert sorted(s['nome'] for s in corpo['servicos']) == ['app', 'realtime', 'webhooks']
            assert all(isinstance(s['latenciaMs'], (int, float)) for s in corpo['servicos'])
            assert corpo['maiorDivergenciaDeRelogioSegundos'] < 2
            assert all(s['versao'] == 'test-revision' for s in corpo['servicos'])
            run('--base-url', url_app, '--expect-services', 'app,realtime,webhooks',
                '--service', f'realtime={url_rt}', '--service', f'webhooks={url_wh}',
                '--expected-version', 'test-revision')
            diferente = run('--base-url', url_app, '--expect-services', 'app,realtime',
                            '--service', f'realtime={url_rt}',
                            '--expected-version', 'outra-revision', esperado=1)
            assert 'versão' in diferente.stdout + diferente.stderr
            assert json.loads(prova.read_text())['ok'] is True

        # ─── 4. Serviço que responde `ok: false` reprova com saída 1 ────────
        ruim, url_ruim = servidor({'/health': (200, {'ok': False, 'service': 'legis-webhooks'})})
        try:
            falha = run('--base-url', url_app, '--expect-services', 'app,webhooks',
                        '--service', f'webhooks={url_ruim}', esperado=1)
            assert 'webhooks' in falha.stdout + falha.stderr
        finally:
            ruim.shutdown()

        # ─── 5. Relógio divergente reprova, nomeando o desvio ───────────────
        torto, url_torto = servidor({'/health': (200, {'ok': True, 'service': 'legis-realtime'})},
                                    desvio_de_relogio=30)
        try:
            falha = run('--base-url', url_app, '--expect-services', 'app,realtime',
                        '--service', f'realtime={url_torto}', esperado=1)
            saida = falha.stdout + falha.stderr
            assert 'rel' in saida.lower(), saida
        finally:
            torto.shutdown()
        sem_banco, url_sem_banco = servidor({
            '/api/v1/health': (503, {'ok': False, 'database': 'unavailable',
                                     'version': 'test-revision'}),
        })
        try:
            falha = run('--base-url', url_sem_banco, '--expect-services', 'app', esperado=1)
            corpo = json.loads(falha.stdout)
            assert corpo['servicos'][0]['database'] == 'unavailable'
            assert corpo['servicos'][0]['status'] == 503
        finally:
            sem_banco.shutdown()

        # ─── 6. Uma mudança gera um evento; repetição mantém o incidente ──
        rotas_estado = {
            '/api/v1/health': (200, {'ok': True, 'version': 'test-revision'}),
            '/api/v1/bootstrap': (200, {'tenant': {'slug': 'staging-example'}}),
        }
        monitorado, url_monitorado = servidor(rotas_estado)
        try:
            with tempfile.TemporaryDirectory() as pasta:
                estado = Path(pasta) / 'estado.json'
                eventos = Path(pasta) / 'eventos.jsonl'
                comando = ('--base-url', url_monitorado, '--expect-services', 'app',
                           '--state-file', str(estado), '--events-file', str(eventos))
                run(*comando)
                assert json.loads(estado.read_text())['ok'] is True
                assert not eventos.exists()

                rotas_estado['/api/v1/health'] = (503, {'ok': False, 'database': 'unavailable'})
                run(*comando, esperado=1)
                primeiro = json.loads(eventos.read_text().splitlines()[0])
                assert primeiro['kind'] == 'degraded'
                assert primeiro['incidentId']
                run(*comando, esperado=1)
                assert len(eventos.read_text().splitlines()) == 1
                assert json.loads(estado.read_text())['incidentId'] == primeiro['incidentId']

                rotas_estado['/api/v1/health'] = (200, {'ok': True, 'version': 'test-revision'})
                run(*comando)
                registros = [json.loads(linha) for linha in eventos.read_text().splitlines()]
                assert len(registros) == 2
                assert registros[1]['kind'] == 'recovered'
                assert registros[1]['incidentId'] == primeiro['incidentId']
                assert json.loads(estado.read_text())['incidentId'] is None
        finally:
            monitorado.shutdown()
    finally:
        rt.shutdown()
        wh.shutdown()
finally:
    app.shutdown()

print('verificação remota: host ausente, serviço sem URL, serviço doente, '
      'relógio divergente, transições de incidente e caminho feliz conferidos')
