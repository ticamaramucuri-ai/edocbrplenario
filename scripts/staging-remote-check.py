#!/usr/bin/env python3
"""Verificação de saúde de uma instalação, feita de fora dela.

Confere, em uma passada: o app responde `/api/v1/bootstrap`, cada serviço
esperado responde `/health` com `ok: true`, e os relógios divergem menos do
limite. Grava JSON com horário, latências e o que foi observado.

Saídas: 0 tudo certo · 1 serviço doente ou relógio divergente · 2 alvo
inacessível ou serviço esperado sem como ser verificado.

    python3 scripts/staging-remote-check.py --base-url https://stage.example.org \\
      --expect-services app,realtime,webhooks,scheduler --platform-email usuario

Num host dedicado, só o proxy TLS do gateway fica exposto — banco, Redis,
webhooks e scheduler seguem na rede privada (ver deploy/staging/README.md). Para
conferi-los de fora, informe credenciais de plataforma: o roteiro lê
`/api/v1/platform/system-status`, que o próprio app consulta por dentro.
"""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import time
from uuid import uuid4
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener
import http.cookiejar

# Serviços que o app sabe conferir por dentro, em `platform/system-status`.
PELO_APP = {'realtime', 'webhooks', 'scheduler', 'mail'}


def argumentos(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--base-url', required=True, help='base do app, ex.: http://host:3100')
    parser.add_argument('--expect-services', default='app',
                        help='lista separada por vírgula; `app` é sempre conferido')
    parser.add_argument('--service', action='append', default=[], metavar='nome=url',
                        help='URL direta de um serviço; pode repetir')
    parser.add_argument('--platform-email', default=os.getenv('EDOCBR_PLATFORM_EMAIL'),
                        help='ator de plataforma para ler system-status; também aceita EDOCBR_PLATFORM_EMAIL')
    parser.add_argument('--platform-password', default=os.getenv('EDOCBR_PLATFORM_PASSWORD'),
                        help='também aceita EDOCBR_PLATFORM_PASSWORD')
    parser.add_argument('--max-clock-skew', type=float, default=2.0,
                        help='divergência máxima de relógio, em segundos (padrão 2)')
    parser.add_argument('--expected-version', help='revisão imutável esperada no app e nos serviços')
    parser.add_argument('--timeout', type=float, default=10.0)
    parser.add_argument('--output', help='arquivo onde gravar a prova em JSON')
    parser.add_argument('--state-file', help='estado local para registrar mudança saudável/degradado')
    parser.add_argument('--events-file', help='histórico JSONL das mudanças de estado')
    return parser.parse_args(argv)


def registrar_transicao(prova: dict, estado_path: Path, eventos_path: Path) -> None:
    anterior = json.loads(estado_path.read_text()) if estado_path.exists() else None
    agora = prova['data']
    saudavel = prova['ok']
    mudou = anterior is None and not saudavel or anterior is not None and anterior['ok'] != saudavel
    incidente = (anterior or {}).get('incidentId')
    if not saudavel and not incidente:
        incidente = str(uuid4())
    evento = None
    if mudou:
        evento = {'eventId': str(uuid4()), 'incidentId': incidente,
                  'kind': 'recovered' if saudavel else 'degraded',
                  'at': agora, 'unreachable': prova['inacessiveis'],
                  'problemCount': len(prova['problemas'])}
    estado = {'ok': saudavel, 'incidentId': None if saudavel else incidente,
              'checkedAt': agora, 'lastTransitionAt': agora if mudou else (anterior or {}).get('lastTransitionAt')}
    estado_path.parent.mkdir(parents=True, exist_ok=True)
    eventos_path.parent.mkdir(parents=True, exist_ok=True)
    if evento:
        fd = os.open(eventos_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(json.dumps(evento, ensure_ascii=False) + '\n')
    fd, temp_name = tempfile.mkstemp(prefix='.remote-check-', dir=estado_path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(estado, stream, ensure_ascii=False)
            stream.write('\n')
        os.replace(temp_name, estado_path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def opener():
    contexto = ssl.create_default_context()
    return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar())), contexto


def buscar(cliente, url: str, timeout: float, payload=None):
    """Devolve (status, corpo, divergência de relógio em s, latência em ms)."""
    corpo = None if payload is None else json.dumps(payload).encode()
    headers = {'User-Agent': 'edocbr-staging-observer/1.0'}
    if corpo:
        headers['Content-Type'] = 'application/json'
    pedido = Request(url, corpo, headers)
    inicio = time.monotonic()
    try:
        with cliente.open(pedido, timeout=timeout) as resposta:
            status, dados, cabecalhos = resposta.status, resposta.read(), resposta.headers
    except HTTPError as erro:
        status, dados, cabecalhos = erro.code, erro.read(), erro.headers
    except (URLError, OSError, TimeoutError) as erro:
        raise ConnectionError(str(erro)) from erro
    latencia = round((time.monotonic() - inicio) * 1000, 2)

    divergencia = None
    data = cabecalhos.get('Date') if cabecalhos else None
    if data:
        try:
            # O cabeçalho Date tem resolução de 1 s: mede desacordo grosseiro de
            # relógio, que é o que invalida correlacionar log entre máquinas.
            divergencia = abs((parsedate_to_datetime(data)
                               - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError):
            divergencia = None
    try:
        conteudo = json.loads(dados) if dados else {}
    except json.JSONDecodeError:
        conteudo = {}
    return status, conteudo, divergencia, latencia


def main(argv: list[str]) -> int:
    opcoes = argumentos(argv)
    base = opcoes.base_url.rstrip('/')
    esperados = [nome.strip() for nome in opcoes.expect_services.split(',') if nome.strip()]
    if 'app' not in esperados:
        esperados.insert(0, 'app')

    diretos: dict[str, str] = {}
    for item in opcoes.service:
        if '=' not in item:
            print(f'--service precisa de nome=url: {item}', file=sys.stderr)
            return 2
        nome, url = item.split('=', 1)
        diretos[nome.strip()] = url.strip().rstrip('/')

    cliente, _ = opener()
    observados: list[dict] = []
    problemas: list[str] = []
    inacessiveis: list[str] = []

    # ─── app ─────────────────────────────────────────────────────────────────
    try:
        status, health, divergencia, latencia = buscar(
            cliente, f'{base}/api/v1/health?ready=1', opcoes.timeout)
        saudavel = status == 200 and health.get('ok') is True
        tenant_slug = None
        if saudavel:
            bootstrap_status, corpo, _, _ = buscar(
                cliente, f'{base}/api/v1/bootstrap', opcoes.timeout)
            tenant_slug = (corpo.get('tenant') or {}).get('slug')
            saudavel = bootstrap_status == 200 and bool(tenant_slug)
        observados.append({'nome': 'app', 'url': base, 'via': 'direto', 'status': status,
                           'ok': saudavel, 'latenciaMs': latencia,
                           'divergenciaDeRelogioSegundos': divergencia,
                           'tenant': tenant_slug, 'database': health.get('database'),
                           'versao': health.get('version')})
        if not saudavel:
            problemas.append(f'app sem prontidão (health HTTP {status}, banco={health.get("database")}) ou sem Câmara no bootstrap')
    except ConnectionError as erro:
        inacessiveis.append('app')
        observados.append({'nome': 'app', 'url': base, 'via': 'direto', 'ok': False,
                           'erro': str(erro)[:200]})

    # ─── serviços com URL direta ─────────────────────────────────────────────
    for nome in [n for n in esperados if n != 'app' and n in diretos]:
        url = f'{diretos[nome]}/health'
        try:
            status, corpo, divergencia, latencia = buscar(cliente, url, opcoes.timeout)
            saudavel = status == 200 and corpo.get('ok') is True
            observados.append({'nome': nome, 'url': diretos[nome], 'via': 'direto',
                               'status': status, 'ok': saudavel, 'latenciaMs': latencia,
                               'divergenciaDeRelogioSegundos': divergencia,
                               'servico': corpo.get('service'),
                               'versao': corpo.get('version'),
                               'uptimeSegundos': corpo.get('uptimeSeconds'),
                               'fanout': corpo.get('fanout')})
            if not saudavel:
                problemas.append(f'{nome} respondeu HTTP {status} com ok={corpo.get("ok")}')
        except ConnectionError as erro:
            inacessiveis.append(nome)
            observados.append({'nome': nome, 'url': diretos[nome], 'via': 'direto',
                               'ok': False, 'erro': str(erro)[:200]})

    # ─── serviços lidos pelo app, quando houver credencial de plataforma ─────
    faltantes = [n for n in esperados
                 if n != 'app' and n not in diretos and n not in inacessiveis]
    pelo_app: dict[str, dict] = {}
    if faltantes and opcoes.platform_email and opcoes.platform_password:
        try:
            status, _, _, _ = buscar(cliente, f'{base}/api/v1/auth/login', opcoes.timeout,
                                     {'email': opcoes.platform_email,
                                      'password': opcoes.platform_password})
            if status != 200:
                problemas.append(f'login de plataforma respondeu HTTP {status}')
            else:
                status, corpo, _, latencia = buscar(
                    cliente, f'{base}/api/v1/platform/system-status', opcoes.timeout)
                if status != 200:
                    problemas.append(f'system-status respondeu HTTP {status}')
                else:
                    for servico in corpo.get('services') or []:
                        pelo_app[str(servico.get('id'))] = servico
                    observados.append({'nome': 'system-status', 'url': base, 'via': 'app',
                                       'status': status, 'ok': True, 'latenciaMs': latencia,
                                       'servicosRelatados': sorted(pelo_app)})
        except ConnectionError as erro:
            problemas.append(f'system-status inacessível: {str(erro)[:150]}')

    for nome in faltantes:
        servico = pelo_app.get(nome)
        if servico is None:
            razao = ('não tem URL direta e o app não o relata'
                     if nome not in PELO_APP or not pelo_app
                     else 'ausente no system-status do app')
            inacessiveis.append(nome)
            observados.append({'nome': nome, 'via': 'nenhuma', 'ok': False, 'erro': razao})
            continue
        # `platform/system-status` devolve {id, name, url, ok, latencyMs, detail}.
        saudavel = servico.get('ok') is True
        observados.append({'nome': nome, 'via': 'app', 'ok': saudavel,
                           'versao': servico.get('version'),
                           'detalheRelatado': servico.get('detail'),
                           'latenciaMs': servico.get('latencyMs')})
        if not saudavel:
            problemas.append(f'{nome} relatado pelo app como doente: '
                             f'{servico.get("detail") or "sem detalhe"}')

    divergencias = [o['divergenciaDeRelogioSegundos'] for o in observados
                    if isinstance(o.get('divergenciaDeRelogioSegundos'), (int, float))]
    if opcoes.expected_version:
        for item in observados:
            if item.get('nome') in esperados and item.get('ok') and item.get('versao') != opcoes.expected_version:
                problemas.append(f'{item["nome"]}: versão {item.get("versao")!r} difere de {opcoes.expected_version!r}')
    maior_divergencia = max(divergencias) if divergencias else None
    if maior_divergencia is not None and maior_divergencia >= opcoes.max_clock_skew:
        problemas.append(f'relógio divergente: {maior_divergencia:.1f} s '
                         f'(limite {opcoes.max_clock_skew} s)')

    # Alvo em loopback não é verificação remota, e o relatório diz isso.
    remoto = not any(marca in base for marca in ('127.0.0.1', 'localhost', '::1'))

    prova = {
        'ok': not problemas and not inacessiveis,
        'data': datetime.now(timezone.utc).isoformat(),
        'baseUrl': base,
        'remoto': remoto,
        'esperados': esperados,
        'versaoEsperada': opcoes.expected_version,
        'servicos': observados,
        'inacessiveis': sorted(set(inacessiveis)),
        'problemas': problemas,
        'maiorDivergenciaDeRelogioSegundos': maior_divergencia,
        'limiteDeDivergenciaSegundos': opcoes.max_clock_skew,
        'limites': [
            'Versão local-unversioned não identifica um build implantado; configure STAGE_BUILD_VERSION antes de construir a imagem.',
            'O cabeçalho Date tem resolução de 1 s: mede desacordo grosseiro, não sincronia fina.',
        ] + ([] if remoto else ['Alvo em loopback: não é verificação de fora do host.']),
    }
    saida = json.dumps(prova, ensure_ascii=False, indent=2, sort_keys=True)
    print(saida)
    if opcoes.output:
        Path(opcoes.output).write_text(saida + '\n')
    if opcoes.state_file:
        registrar_transicao(prova, Path(opcoes.state_file),
                            Path(opcoes.events_file) if opcoes.events_file
                            else Path(opcoes.state_file).with_suffix('.events.jsonl'))

    if inacessiveis:
        print(f'Inacessíveis ou sem como verificar: {", ".join(sorted(set(inacessiveis)))}',
              file=sys.stderr)
        return 2
    if problemas:
        print('; '.join(problemas), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
