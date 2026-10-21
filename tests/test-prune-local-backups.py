#!/usr/bin/env python3
"""Retenção de backups locais: a simulação é o padrão e o padrão citado é poupado."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/prune-local-backups.py'


def run(*args: str, success=True):
    result = subprocess.run(['python3', '-I', str(SCRIPT), *args], capture_output=True, text=True)
    if success and result.returncode:
        raise AssertionError(result.stderr)
    if not success and result.returncode == 0:
        raise AssertionError(f'Comando deveria falhar: {result.stdout}{result.stderr}')
    return result


def nomes(saida: str) -> dict:
    return json.loads(saida)


with tempfile.TemporaryDirectory() as directory:
    base = Path(directory)
    agora = time.time()
    # Oito backups por horário e dois nomeados por etapa citada em documento.
    for indice in range(8):
        arquivo = base / f'custom.db.backup.2026101{indice}T000000Z'
        arquivo.write_bytes(b'x' * 16)
        os.utime(arquivo, (agora - (8 - indice) * 3600, agora - (8 - indice) * 3600))
    for etapa in ('etapa-045', 'etapa-051'):
        arquivo = base / f'custom.db.backup.{etapa}'
        arquivo.write_bytes(b'x' * 16)
        os.utime(arquivo, (agora - 100 * 3600, agora - 100 * 3600))
    (base / 'custom.db').write_bytes(b'base ativa')

    simulacao = nomes(run('--directory', str(base), '--keep', '3',
                          '--keep-pattern', 'etapa-').stdout)
    assert simulacao['applied'] is False, simulacao
    assert simulacao['kept'] == 5, simulacao          # 3 recentes + 2 por padrão
    assert len(simulacao['removable']) == 5, simulacao
    assert all('etapa-' not in nome for nome in simulacao['removable']), simulacao
    assert len(list(base.glob('custom.db.backup.*'))) == 10, 'simulação não remove'

    resultado = nomes(run('--directory', str(base), '--keep', '3',
                          '--keep-pattern', 'etapa-', '--apply').stdout)
    assert resultado['applied'] is True, resultado
    assert resultado['removed'] == 5, resultado
    restantes = sorted(p.name for p in base.glob('custom.db.backup.*'))
    assert restantes == [
        'custom.db.backup.20261015T000000Z',
        'custom.db.backup.20261016T000000Z',
        'custom.db.backup.20261017T000000Z',
        'custom.db.backup.etapa-045',
        'custom.db.backup.etapa-051',
    ], restantes
    assert (base / 'custom.db').read_bytes() == b'base ativa', 'a base ativa nunca é tocada'

    # Repetir é inócuo e --keep 0 sem padrão não é aceito em silêncio.
    assert nomes(run('--directory', str(base), '--keep', '3', '--keep-pattern', 'etapa-',
                     '--apply').stdout)['removed'] == 0
    run('--directory', str(base), '--keep', '-1', success=False)
    run('--directory', str(base / 'inexistente'), success=False)

print('retenção de backups: simulação, aplicação e proteção por padrão conferidas')
