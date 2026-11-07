#!/usr/bin/env python3
"""Run and inspect a synthetic staging backup cycle on an independent host.

The private JSON config names files and hosts, not passwords. This tool does
not schedule itself or send alerts; `check` exits nonzero for an external
monitor. Keep the receiver and its vault off the VPS.
"""

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def private_config(path: Path) -> dict:
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError('Configuração deve ser arquivo absoluto regular.')
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError('Configuração deve ter modo 0600 ou mais restrito.')
    value = json.loads(path.read_text())
    if value.get('scope') != 'synthetic-staging':
        raise ValueError('Somente staging sintética é aceita.')
    vault = Path(value['vault'])
    if not vault.is_absolute() or vault.is_symlink() or not vault.is_dir():
        raise ValueError('Vault privado deve existir em caminho absoluto.')
    if stat.S_IMODE(vault.stat().st_mode) & 0o077:
        raise ValueError('Vault deve ter modo 0700 ou mais restrito.')
    if not isinstance(value.get('maxAgeHours'), (int, float)) or value['maxAgeHours'] <= 0:
        raise ValueError('maxAgeHours deve ser positivo.')
    if not isinstance(value.get('keep'), int) or value['keep'] < 1:
        raise ValueError('keep deve ser positivo.')
    return value


def status_path(vault: Path) -> Path:
    return vault / '.backup-status.json'


def write_status(vault: Path, status: dict) -> None:
    with tempfile.NamedTemporaryFile('w', prefix='.backup-status-', suffix='.tmp',
                                     dir=vault, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(status, stream, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(status_path(vault))


def read_status(vault: Path) -> dict:
    path = status_path(vault)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Estado de backup ausente ou inseguro.')
    return json.loads(path.read_text())


def vault_command(config: dict) -> list[str]:
    args = [sys.executable, str(ROOT / 'scripts/staging-offhost-vault.py'),
            '--vault', config['vault'], '--cert', config['cert'], '--key', config['key'],
            '--remote-cert', config['remoteCert'], '--keep', str(config['keep'])]
    if config.get('localSource') is True:
        args.append('--local-source')
    else:
        for key, flag in [('target', '--target'), ('identity', '--identity'),
                          ('remoteRepo', '--remote-repo')]:
            if not config.get(key):
                raise ValueError(f'Configuração sem {key}.')
            args.extend([flag, config[key]])
    return args


def run_cycle(config: dict) -> dict:
    vault = Path(config['vault'])
    lock_path = vault / '.backup.lock'
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Outra coleta já está em andamento.') from error
        previous = read_status(vault) if status_path(vault).exists() else {}
        attempted = utc_now().isoformat()
        try:
            result = subprocess.run(vault_command(config), capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError('Coleta ou verificação falhou: ' + result.stderr[-1000:])
            proof = json.loads(result.stdout)
            snapshot = Path(proof['snapshot'])
            if snapshot.parent != vault or not snapshot.is_file():
                raise ValueError('Receptor não retornou snapshot no vault configurado.')
            status = {'scope': 'synthetic-staging', 'lastAttemptAt': attempted,
                      'lastAttempt': 'success', 'lastSuccessAt': utc_now().isoformat(),
                      'snapshot': str(snapshot), 'ciphertextSha256': proof['ciphertextSha256'],
                      'manifestSha256': proof['manifestSha256']}
            write_status(vault, status)
            return status
        except Exception as error:
            status = {'scope': 'synthetic-staging', 'lastAttemptAt': attempted,
                      'lastAttempt': 'failed', 'error': str(error)[:1000]}
            for key in ('lastSuccessAt', 'snapshot', 'ciphertextSha256', 'manifestSha256'):
                if key in previous:
                    status[key] = previous[key]
            write_status(vault, status)
            raise
    finally:
        os.close(descriptor)


def _check_locked(config: dict) -> dict:
    vault = Path(config['vault'])
    status = read_status(vault)
    if status.get('scope') != 'synthetic-staging' or status.get('lastAttempt') != 'success':
        raise RuntimeError('Última tentativa de backup não foi bem-sucedida.')
    received = datetime.fromisoformat(status['lastSuccessAt'])
    if received.tzinfo is None:
        raise ValueError('Horário sem fuso no estado.')
    age_hours = (utc_now() - received).total_seconds() / 3600
    if age_hours < -0.1 or age_hours > config['maxAgeHours']:
        raise RuntimeError(f'Último backup fora do prazo: {age_hours:.2f} horas.')
    snapshot = Path(status['snapshot'])
    if snapshot.parent != vault or snapshot.is_symlink() or not snapshot.is_file():
        raise RuntimeError('Objeto cifrado ausente ou fora do vault.')
    sidecar = snapshot.with_suffix('.json')
    if sidecar.is_symlink() or not sidecar.is_file():
        raise RuntimeError('Metadados da cópia ausentes.')
    metadata = json.loads(sidecar.read_text())
    if (sha256(snapshot) != status['ciphertextSha256'] or
            metadata.get('ciphertextSha256') != status['ciphertextSha256'] or
            metadata.get('manifestSha256') != status['manifestSha256']):
        raise RuntimeError('Hash do snapshot ou metadados divergiu.')
    return {'ok': True, 'scope': 'synthetic-staging', 'ageHours': round(age_hours, 3),
            'snapshot': str(snapshot), 'ciphertextSha256': status['ciphertextSha256']}


def check_cycle(config: dict) -> dict:
    vault = Path(config['vault'])
    descriptor = os.open(vault / '.backup.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_SH)
        return _check_locked(config)
    finally:
        os.close(descriptor)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('run', 'check'))
    parser.add_argument('--config', required=True, type=Path)
    args = parser.parse_args()
    try:
        config = private_config(args.config)
        result = run_cycle(config) if args.command == 'run' else check_cycle(config)
        print(json.dumps(result, sort_keys=True))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)[:1000]}), file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == '__main__':
    main()
