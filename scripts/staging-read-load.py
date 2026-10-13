#!/usr/bin/env python3
"""Bounded synthetic read baseline; this is not an institutional capacity claim."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import statistics
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'deploy/staging/.env'
values = dict(line.split('=', 1) for line in CONFIG.read_text().splitlines()
              if '=' in line and not line.startswith('#'))
base = f"http://127.0.0.1:{values.get('STAGE_APP_PORT', '3100')}"
routes = [('/api/v1/bootstrap', 200, {}),
          ('/api/v1/public/sessions?tenant=staging-example', 200, {}),
          ('/api/v1/public/sessions/stage-media-recovery/replay?tenant=staging-example',
           206, {'Range': 'bytes=0-31'})]
requests = 300
concurrency = 16


def read(index):
    path, expected, headers = routes[index % len(routes)]
    start = time.monotonic()
    try:
        with urlopen(Request(base + path, headers=headers), timeout=15) as response:
            body = response.read()
            status = response.status
        valid = status == expected and bool(body) and (expected != 206 or len(body) == 32)
        return index % len(routes), valid, round((time.monotonic() - start) * 1000, 2)
    except Exception:
        return index % len(routes), False, round((time.monotonic() - start) * 1000, 2)


# Fail fast if the intended fixture and public paths are absent.
for index in range(len(routes)):
    kind, valid, _ = read(index)
    if not valid:
        raise RuntimeError(f'Pré-condição da rota {kind} falhou; execute o ensaio de mídia primeiro.')

start = time.monotonic()
with ThreadPoolExecutor(max_workers=concurrency) as pool:
    results = list(as_completed([pool.submit(read, i) for i in range(requests)]))
    rows = [future.result() for future in results]
elapsed = round(time.monotonic() - start, 3)
latencies = sorted(row[2] for row in rows)
by_route = [{'route': routes[i][0], 'ok': sum(1 for kind, valid, _ in rows if kind == i and valid),
             'errors': sum(1 for kind, valid, _ in rows if kind == i and not valid)}
            for i in range(len(routes))]
report = {'ok': all(row[1] for row in rows), 'synthetic': True, 'requests': requests,
          'concurrency': concurrency, 'elapsedSeconds': elapsed,
          'throughputPerSecond': round(requests / elapsed, 1),
          'p50Ms': statistics.median(latencies), 'p95Ms': latencies[int(requests * 0.95) - 1],
          'p99Ms': latencies[int(requests * 0.99) - 1], 'routes': by_route}
print(json.dumps(report, sort_keys=True))
if not report['ok']:
    raise SystemExit(1)
