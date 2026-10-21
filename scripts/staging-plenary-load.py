#!/usr/bin/env python3
"""Carga concorrente de jornada do plenário, telão e portal na homologação sintética.

Põe ao mesmo tempo, contra a stack isolada: 13 parlamentares votando, dois
telões conectados em nós distintos de tempo real, N leitores do portal e
comandos de telão (congelar, liberar, trocar perfil) durante a votação aberta.

Mede e devolve `{atrasoEventoP50, atrasoEventoP95, atrasoQuadroCongelado,
errosHttp, eventosPerdidos}` — número observado, nunca meta institucional.

Falha (saída 1) quando acusa evento perdido, erro HTTP, voto duplicado ou quadro
congelado que mudou de hash enquanto o estado interno avançava.

    python3 scripts/staging-plenary-load.py --rodadas 3 --leitores 4
    python3 scripts/staging-plenary-load.py --queda-no 1 --queda-por 8   # falha induzida

A queda induzida existe para provar o detector: o telão escolhido sai da sala
por alguns segundos e o roteiro precisa acusar `eventosPerdidos > 0`.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import http.cookiejar
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
TENANT_SLUG = 'staging-example'
PERFIS = ('presenca', 'votacao', 'pauta')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--rodadas', type=int, default=3, help='votações na jornada (1–10)')
parser.add_argument('--parlamentares', type=int, default=13, help='votantes simultâneos (3–30)')
parser.add_argument('--leitores', type=int, default=4, help='leitores do portal (1–16)')
parser.add_argument('--queda-no', type=int, default=-1, help='índice do telão que cai (0 ou 1)')
parser.add_argument('--queda-apos', type=int, default=6, help='segundos até a queda induzida')
parser.add_argument('--queda-por', type=int, default=0, help='duração da queda, em segundos')
parser.add_argument('--output', help='arquivo onde gravar a prova em JSON')
args = parser.parse_args()
if not 1 <= args.rodadas <= 10 or not 3 <= args.parlamentares <= 30 or not 1 <= args.leitores <= 16:
    parser.error('Use 1–10 rodadas, 3–30 parlamentares e 1–16 leitores.')

valores = dict(linha.split('=', 1) for linha in CONFIG.read_text().splitlines()
               if '=' in linha and not linha.startswith('#'))
base = f"http://127.0.0.1:{valores.get('STAGE_APP_PORT', '3100')}"
nos = [f"http://127.0.0.1:{valores.get('STAGE_REALTIME_PORT', '3103')}",
       f"http://127.0.0.1:{valores.get('STAGE_REALTIME_PEER_PORT', '3104')}"]
pg = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': valores.get('STAGE_DB_PORT', '55432'),
      'PGUSER': 'edocbr_stage', 'PGDATABASE': 'edocbr_stage',
      'PGPASSWORD': valores['STAGE_DB_PASSWORD']}


def consulta(sql: str) -> str:
    return subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                          cwd=ROOT, env=pg, text=True, capture_output=True,
                          check=True).stdout.strip()


def cliente():
    return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))


erros_http: list[str] = []


def chamar(opener, caminho, payload=None, esperado=200):
    corpo = None if payload is None else json.dumps(payload).encode()
    pedido = Request(base + caminho, corpo, {'Content-Type': 'application/json'} if corpo else {})
    inicio = time.monotonic()
    try:
        with opener.open(pedido, timeout=25) as resposta:
            status, dados = resposta.status, resposta.read()
    except HTTPError as erro:
        status, dados = erro.code, erro.read()
    decorrido = round((time.monotonic() - inicio) * 1000, 2)
    if status != esperado:
        erros_http.append(f'{caminho}: HTTP {status}')
        raise RuntimeError(f'{caminho}: HTTP {status}, esperado {esperado}: '
                           f'{dados[:300].decode(errors="replace")}')
    return json.loads(dados), decorrido


# ─── Guardas: só na base sintética exclusiva e com a stack sadia ─────────────
if consulta('SELECT string_agg(slug, \',\' ORDER BY slug) FROM "Tenant"') != TENANT_SLUG:
    raise RuntimeError('Carga permitida somente na base com o tenant sintético exclusivo.')
if consulta('SELECT count(*) FROM "Session" WHERE status IN '
            "('check_in','open','suspended','resumed')") != '0':
    raise RuntimeError('Há sessão em andamento na homologação; carga recusada.')
tenant_id = consulta(f"SELECT id FROM \"Tenant\" WHERE slug='{TENANT_SLUG}'")
if not tenant_id.isalnum():
    raise RuntimeError('Tenant sintético ausente.')
for url in nos:
    try:
        with urlopen(f'{url}/health', timeout=5) as r:
            if not json.loads(r.read()).get('ok'):
                raise RuntimeError(f'Nó de tempo real não saudável: {url}')
    except Exception as erro:
        raise RuntimeError(f'Nó de tempo real inacessível ({url}): {erro}') from erro

# ─── Atores e votantes sintéticos ────────────────────────────────────────────
admin = cliente()
operador = cliente()
senha = valores['STAGE_ADMIN_PASSWORD']
if chamar(admin, '/api/v1/auth/login',
          {'email': 'stage-admin@example.invalid', 'password': senha})[0]['actor']['role'] != 'tenant_admin':
    raise RuntimeError('Administrador sintético inválido.')
if chamar(operador, '/api/v1/auth/login',
          {'email': 'stage-vote-operator@example.invalid', 'password': senha})[0]['actor']['role'] != 'session_operator':
    raise RuntimeError('Operador sintético ausente; execute scripts/staging-vote-load.py uma vez.')

pessoas = chamar(admin, '/api/v1/parliamentarians')[0]['parliamentarians']
presidente = next((p for p in pessoas if p['name'] == 'Presidente de Ensaio'), None)
if not presidente:
    raise RuntimeError('Execute scripts/staging-smoke.py antes da carga.')
carga = sorted((p for p in pessoas if p['name'].startswith('Parlamentar de Carga ')),
               key=lambda p: p['name'])
for indice in range(len(carga), args.parlamentares - 1):
    criado = chamar(admin, '/api/v1/parliamentarians',
                    {'name': f'Parlamentar de Carga {indice + 1:02}', 'party': 'EXP'}, 201)[0]
    carga.append(criado['parliamentarian'])
votantes = [presidente, *carga[:args.parlamentares - 1]]
if len(votantes) != args.parlamentares:
    raise RuntimeError('Não foi possível reunir os votantes pedidos.')

# ─── Telões sintéticos, um por nó de tempo real ──────────────────────────────
duracao_observador = 60 + args.rodadas * 40
comando_observador = [
    'bun', str(ROOT / 'scripts/staging-display-observers.ts'),
    '--tenant', tenant_id, '--urls', ','.join(nos), '--segundos', str(duracao_observador),
]
if args.queda_no >= 0 and args.queda_por > 0:
    comando_observador += ['--queda-no', str(args.queda_no),
                           '--queda-apos', str(args.queda_apos),
                           '--queda-por', str(args.queda_por)]
observador = subprocess.Popen(comando_observador, cwd=ROOT, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True, bufsize=1)
observados: list[dict] = []
observador_erros: list[str] = []


def ler_observador():
    for linha in observador.stdout:
        linha = linha.strip()
        if not linha:
            continue
        try:
            observados.append(json.loads(linha))
        except json.JSONDecodeError:
            observador_erros.append(linha[:200])


leitor_observador = threading.Thread(target=ler_observador, daemon=True)
leitor_observador.start()

prazo = time.monotonic() + 25
while sum(1 for e in observados if e.get('tipo') == 'inscrito') < len(nos):
    if time.monotonic() >= prazo:
        observador.terminate()
        raise RuntimeError(f'Telões sintéticos não entraram na sala pública: {observados}')
    time.sleep(0.2)

# ─── Leitores do portal ──────────────────────────────────────────────────────
rotas = ('/api/v1/bootstrap',
         f'/api/v1/public/sessions?tenant={TENANT_SLUG}',
         f'/api/v1/public/live?tenant={TENANT_SLUG}')
parar = threading.Event()


def ler(caminho):
    inicio = time.monotonic()
    try:
        with urlopen(Request(base + caminho), timeout=10) as resposta:
            corpo = resposta.read()
            valido = resposta.status == 200 and corpo.startswith(b'{')
        return valido, round((time.monotonic() - inicio) * 1000, 2)
    except Exception:
        return False, round((time.monotonic() - inicio) * 1000, 2)


def leitor(indice):
    linhas = []
    turno = indice
    while not parar.is_set():
        linhas.append(ler(rotas[turno % len(rotas)]))
        turno += 1
        parar.wait(0.05)
    return linhas


def quadro_publico() -> dict:
    corpo, _ = chamar(admin, f'/api/v1/public/live?tenant={TENANT_SLUG}')
    return corpo.get('displayState') or {}


# ─── Jornada com comandos de telão durante a votação ─────────────────────────
inicio = time.monotonic()
congelamentos: list[dict] = []
rodadas: list[dict] = []
tempos_de_voto: list[float] = []
sessao_id = ''

with ThreadPoolExecutor(max_workers=args.leitores) as piscina:
    futuros = [piscina.submit(leitor, i) for i in range(args.leitores)]
    try:
        sessao, _ = chamar(admin, '/api/v1/sessions', {
            'type': 'ordinaria',
            'scheduledAt': (datetime.now(timezone.utc) + timedelta(days=45)).isoformat(),
            'presidentId': presidente['id'],
            'notes': 'Carga concorrente de jornada, telão e portal — ensaio sintético',
            'official': False,
        }, 201)
        sessao_id = sessao['session']['id']
        versao = 1
        for acao in ('schedule', 'open_checkin'):
            chamar(admin, f'/api/v1/sessions/{sessao_id}/transition',
                   {'action': acao, 'version': versao})
            versao += 1
        for pessoa in votantes:
            chamar(admin, f'/api/v1/sessions/{sessao_id}/attendance',
                   {'parliamentarianId': pessoa['id'], 'action': 'check_in',
                    'commandId': str(uuid4())})
        chamar(admin, f'/api/v1/sessions/{sessao_id}/transition',
               {'action': 'open_session', 'version': versao})
        versao += 1

        for rodada in range(args.rodadas):
            chamar(operador, '/api/v1/display/command',
                   {'sessionId': sessao_id, 'action': 'profile',
                    'profile': PERFIS[rodada % len(PERFIS)]})
            criada, _ = chamar(admin, f'/api/v1/sessions/{sessao_id}/votings', {
                'question': f'Carga concorrente {rodada + 1}: aprovar?', 'mode': 'nominal',
            }, 201)
            votacao_id = criada['voting']['id']
            chamar(admin, f'/api/v1/votings/{votacao_id}/transition',
                   {'action': 'open', 'version': 1})

            # Metade dos votos, congelamento no meio da votação aberta, resto dos votos.
            metade = len(votantes) // 2
            comandos = [(p['id'], str(uuid4())) for p in votantes]

            def votar(par):
                pessoa_id, comando = par
                _, decorrido = chamar(operador, f'/api/v1/votings/{votacao_id}/votes',
                                      {'parliamentarianId': pessoa_id, 'value': 'sim',
                                       'commandId': comando})
                return decorrido

            with ThreadPoolExecutor(max_workers=metade) as pool:
                tempos_de_voto += list(pool.map(votar, comandos[:metade]))

            pedido_em = time.monotonic()
            chamar(operador, '/api/v1/display/command',
                   {'sessionId': sessao_id, 'action': 'freeze'})
            quadro = {}
            prazo_quadro = time.monotonic() + 15
            while time.monotonic() < prazo_quadro:
                quadro = quadro_publico()
                if quadro.get('mode') == 'frozen' and quadro.get('frozenFrameSha256'):
                    break
                time.sleep(0.1)
            atraso_quadro = round((time.monotonic() - pedido_em) * 1000, 2)
            if quadro.get('mode') != 'frozen' or not quadro.get('frozenFrameSha256'):
                raise RuntimeError('O quadro público não congelou dentro de 15 s.')
            hash_congelado = quadro['frozenFrameSha256']
            versao_congelada = quadro.get('version')

            with ThreadPoolExecutor(max_workers=len(comandos) - metade) as pool:
                tempos_de_voto += list(pool.map(votar, comandos[metade:]))

            # Estado interno avançou (mais votos); o quadro público não pode mudar.
            durante = quadro_publico()
            registrados = chamar(admin, f'/api/v1/sessions/{sessao_id}')[0]
            votacao_atual = next(v for v in registrados['votings'] if v['id'] == votacao_id)
            congelamentos.append({
                'rodada': rodada + 1,
                'atrasoQuadroCongeladoMs': atraso_quadro,
                'hashEstavel': durante.get('frozenFrameSha256') == hash_congelado,
                'versaoEstavel': durante.get('version') == versao_congelada,
                'votosRegistradosDurante': len(votacao_atual.get('votes') or []),
            })

            chamar(operador, '/api/v1/display/command',
                   {'sessionId': sessao_id, 'action': 'unfreeze'})
            encerrada, _ = chamar(admin, f'/api/v1/votings/{votacao_id}/transition',
                                  {'action': 'close', 'version': 2})
            if encerrada['voting']['status'] != 'closed':
                raise RuntimeError('Votação não encerrou.')
            rodadas.append({'rodada': rodada + 1, 'votacaoId': votacao_id,
                            'resultado': encerrada['voting'].get('resultStatus')})

        chamar(admin, f'/api/v1/sessions/{sessao_id}/transition',
               {'action': 'close', 'version': versao})
    finally:
        parar.set()
        leituras = [linha for futuro in futuros for linha in futuro.result(timeout=20)]

# ─── Drenagem da outbox e conferência ────────────────────────────────────────
prazo = time.monotonic() + 60
while consulta(f"SELECT count(*) FROM \"OutboxEvent\" WHERE \"sessionId\"='{sessao_id}' "
               "AND status<>'published'") != '0':
    if time.monotonic() >= prazo:
        raise RuntimeError('A outbox da sessão não drenou após a carga.')
    time.sleep(0.5)

# Dá tempo ao fanout de entregar o que acabou de ser publicado.
time.sleep(3)
observador.terminate()
try:
    observador.wait(timeout=10)
except subprocess.TimeoutExpired:
    observador.kill()
leitor_observador.join(timeout=5)

publicados = {linha for linha in consulta(
    f"SELECT id FROM \"OutboxEvent\" WHERE \"sessionId\"='{sessao_id}' "
    'AND "publicPayload" IS NOT NULL').splitlines() if linha}
por_no = []
perdidos_total = 0
for indice in range(len(nos)):
    recebidos = {e['eventId'] for e in observados
                 if e.get('tipo') == 'evento' and e.get('no') == indice}
    perdidos = sorted(publicados - recebidos)
    perdidos_total += len(perdidos)
    por_no.append({'no': indice, 'url': nos[indice], 'recebidos': len(recebidos & publicados),
                   'perdidos': len(perdidos), 'idsPerdidos': perdidos[:10]})

atrasos = sorted(e['atrasoMs'] for e in observados
                 if e.get('tipo') == 'evento' and isinstance(e.get('atrasoMs'), (int, float))
                 and e['eventId'] in publicados)
votos_no_banco = int(consulta(
    f"SELECT count(*) FROM \"Vote\" v JOIN \"Voting\" g ON g.id = v.\"votingId\" "
    f"WHERE g.\"sessionId\"='{sessao_id}'"))
votos_esperados = args.rodadas * len(votantes)
erros_de_leitura = sum(1 for valido, _ in leituras if not valido)
quedas = [e for e in observados if e.get('tipo') == 'queda']

prova = {
    'ok': False,
    'sintetico': True,
    'oficial': False,
    'data': datetime.now(timezone.utc).isoformat(),
    'tenant': TENANT_SLUG,
    'sessaoId': sessao_id,
    'perfil': {
        'parlamentares': len(votantes),
        'teloes': len(nos),
        'nosDeTempoReal': len(nos),
        'leitores': args.leitores,
        'rodadas': args.rodadas,
        'comandosDeTelaoPorRodada': ['profile', 'freeze', 'unfreeze'],
        'quedaInduzida': bool(quedas),
    },
    'duracaoSegundos': round(time.monotonic() - inicio, 2),
    'atrasoEventoP50': statistics.median(atrasos) if atrasos else None,
    'atrasoEventoP95': atrasos[int(0.95 * (len(atrasos) - 1))] if atrasos else None,
    'atrasoQuadroCongelado': max((c['atrasoQuadroCongeladoMs'] for c in congelamentos),
                                 default=None),
    'errosHttp': len(erros_http) + erros_de_leitura,
    'eventosPerdidos': perdidos_total,
    'eventosPublicosDaSessao': len(publicados),
    'porNo': por_no,
    'votoP50Ms': statistics.median(sorted(tempos_de_voto)) if tempos_de_voto else None,
    'votoP95Ms': sorted(tempos_de_voto)[int(0.95 * (len(tempos_de_voto) - 1))] if tempos_de_voto else None,
    'votos': votos_no_banco,
    'votosEsperados': votos_esperados,
    'leiturasDoPortal': len(leituras),
    'errosDeLeitura': erros_de_leitura,
    'congelamentos': congelamentos,
    'rodadas': rodadas,
    'observadorErros': observador_erros[:5],
}
prova['ok'] = (perdidos_total == 0 and prova['errosHttp'] == 0
               and votos_no_banco == votos_esperados
               and all(c['hashEstavel'] and c['versaoEstavel'] for c in congelamentos)
               and not observador_erros and bool(atrasos))

saida = json.dumps(prova, ensure_ascii=False, indent=2, sort_keys=True)
print(saida)
if args.output:
    Path(args.output).write_text(saida + '\n')
if not prova['ok']:
    raise SystemExit(1)
