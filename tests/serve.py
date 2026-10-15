# Servidor local que aplica las mismas cabeceras que vercel.json (para probar la CSP).
import http.server, json, os, sys
root = sys.argv[1]; port = int(sys.argv[2])
cfg = json.load(open(os.path.join(root, 'vercel.json')))
H = {h['key']: h['value'] for r in cfg['headers'] if r['source'] == '/(.*)' for h in r['headers']}
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
    def end_headers(self):
        for k, v in H.items():
            if k != 'Strict-Transport-Security': self.send_header(k, v)
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
