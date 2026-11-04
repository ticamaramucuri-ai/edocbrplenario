#!/usr/bin/env python3
"""Confere que um 200 malformado não passa como leitura pública saudável."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
from pathlib import Path
import threading

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/staging-fault-matrix.py'
spec = importlib.util.spec_from_file_location('staging_fault_matrix', SCRIPT)
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        status, body = {
            '/ok': (200, b'{"sessions":[]}'),
            '/invalid': (200, b'{invalid'),
            '/wrong-shape': (200, b'{"sessions":null}'),
            '/degraded': (503, b'{"ok":false}'),
        }[self.path]
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    base = f'http://127.0.0.1:{server.server_address[1]}'
    assert matrix.public_read(base + '/ok') == (200, True)
    assert matrix.public_read(base + '/invalid') == (200, False)
    assert matrix.public_read(base + '/wrong-shape') == (200, False)
    assert matrix.public_read(base + '/degraded') == (503, True)
    observation = matrix.summarize_public_reads('realtime', [(200, True), (200, False)])
    assert not observation['expectedBehaviorObserved']
    observation = matrix.summarize_public_reads('postgres', [(200, True), (503, True)])
    assert observation['expectedBehaviorObserved']
finally:
    server.shutdown()

print('Leitura pública: 200 válido, 200 malformado e 503 classificados corretamente.')
