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
app, url_app = servidor({'/api/v1/bootstrap': (200, {'tenant': {'slug': 'staging-example'}})})
try:
    falha = run('--base-url', url_app, '--expect-services', 'app,webhooks', esperado=2)
    saida = falha.stdout + falha.stderr
    assert 'webhooks' in saida, saida

    # ─── 3. Caminho feliz: app + dois serviços respondem ────────────────────
    rt, url_rt = servidor({'/health': (200, {'ok': True, 'service': 'legis-realtime',
                                             'uptimeSeconds': 10})})
    wh, url_wh = servidor({'/health': (200, {'ok': True, 'service': 'legis-webhooks',
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
    finally:
        rt.shutdown()
        wh.shutdown()
finally:
    app.shutdown()

print('verificação remota: host ausente, serviço sem URL, serviço doente, '
      'relógio divergente e caminho feliz conferidos')
