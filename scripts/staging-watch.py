#!/usr/bin/env python3
"""Record transitions between healthy/degraded states from outside containers."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from uuid import uuid4

from staging_health import probe, verify_synthetic_scope

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--seconds', type=int, default=60)
parser.add_argument('--interval', type=float, default=1.0)
parser.add_argument('--output', type=Path)
parser.add_argument('--allow-degraded', action='store_true')
parser.add_argument('--require-recovery', action='store_true')
parser.add_argument('--stop-on-recovery', action='store_true')
args = parser.parse_args()
if not 5 <= args.seconds <= 600 or not 0.5 <= args.interval <= 30:
    parser.error('Use 5–600 segundos e intervalo de 0,5–30 segundos.')
verify_synthetic_scope()
run_id = uuid4().hex
started = time.monotonic()
samples = 0
degraded_samples = 0
transitions = []
previous = None
output = None
if args.output:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    output = os.fdopen(descriptor, 'w')
try:
    while time.monotonic() - started < args.seconds:
        issues = probe()
        samples += 1
        if issues:
            degraded_samples += 1
        state = 'degraded' if issues else 'healthy'
        current = (state, tuple(issues))
        if current != previous:
            event = {'runId': run_id, 'observedAt': datetime.now(timezone.utc).isoformat(),
                     'state': state, 'issues': issues}
            transitions.append(event)
            if output:
                output.write(json.dumps(event, sort_keys=True) + '\n')
                output.flush()
                os.fsync(output.fileno())
            previous = current
            if args.stop_on_recovery and state == 'healthy' and degraded_samples > 0:
                break
        time.sleep(min(args.interval, max(0, args.seconds - (time.monotonic() - started))))
finally:
    if output:
        output.close()
recovered = any(event['state'] == 'degraded' for event in transitions) and transitions[-1]['state'] == 'healthy'
ok = (degraded_samples == 0 or args.allow_degraded) and (not args.require_recovery or recovered)
print(json.dumps({'ok': ok, 'synthetic': True, 'runId': run_id, 'samples': samples,
                  'degradedSamples': degraded_samples, 'transitionCount': len(transitions),
                  'recovered': recovered, 'finalState': transitions[-1]['state'] if transitions else None,
                  'durationSeconds': round(time.monotonic() - started, 2)}, sort_keys=True))
if not ok:
    raise SystemExit(1)
