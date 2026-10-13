#!/usr/bin/env python3
"""Observe health during one or more bounded synthetic voting journeys."""
import argparse
import json
import subprocess
import sys
import time
from staging_health import ROOT, probe, verify_synthetic_scope

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--seconds', type=int, default=45)
parser.add_argument('--runs', type=int, default=1)
parser.add_argument('--interval', type=float, default=2.0)
args = parser.parse_args()
if not 10 <= args.seconds <= 600 or not 1 <= args.runs <= 20 or not 0.5 <= args.interval <= 30:
    parser.error('Use 10–600 segundos, 1–20 jornadas e intervalo de 0,5–30 segundos.')

verify_synthetic_scope()
initial_issues = probe()
if initial_issues:
    raise RuntimeError(f'A stack precisa estar saudável antes do observador: {initial_issues}')


def start_writer():
    return subprocess.Popen([sys.executable, str(ROOT / 'scripts/staging-vote-load.py')],
                            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


started = time.monotonic()
write_started = started
writer = start_writer()
samples = 0
failed_samples = []
loads = []
write_seconds = 0.0
try:
    while time.monotonic() - started < args.seconds or writer is not None:
        if time.monotonic() - started > max(args.seconds + 120, args.runs * 30):
            raise RuntimeError('A carga de escrita excedeu o limite operacional deste ensaio.')
        issues = probe()
        samples += 1
        if issues:
            failed_samples.append({'sample': samples, 'issues': issues})
        if writer is not None and writer.poll() is not None:
            stdout, stderr = writer.communicate(timeout=5)
            write_seconds += time.monotonic() - write_started
            if writer.returncode:
                raise RuntimeError(f'Ensaio de escrita falhou: {stderr[-1000:]}')
            loads.append(json.loads(stdout))
            writer = None
            if len(loads) < args.runs:
                write_started = time.monotonic()
                writer = start_writer()
        time.sleep(args.interval)
finally:
    if writer is not None and writer.poll() is None:
        writer.terminate()
        try:
            writer.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            writer.kill()
            writer.communicate()

summary = {'ok': not failed_samples and len(loads) == args.runs and all(load['ok'] for load in loads),
           'synthetic': True,
           'observer': 'host independente dos processos da stack, mesmo computador',
           'samples': samples, 'durationSeconds': round(time.monotonic() - started, 2),
           'writeSeconds': round(write_seconds, 2), 'runs': len(loads),
           'totalVotes': sum(load['votes'] for load in loads),
           'totalReceipts': sum(load['receipts'] for load in loads),
           'totalVoteOutboxEvents': sum(load['voteOutboxEvents'] for load in loads),
           'worstRunVoteP95Ms': max(load['voteP95Ms'] for load in loads),
           'failedSamples': failed_samples}
if len(loads) == 1:
    summary['writeLoad'] = loads[0]
print(json.dumps(summary, sort_keys=True))
if not summary['ok']:
    raise SystemExit(1)
