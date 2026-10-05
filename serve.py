# Local dev server: serves this folder (wherever it's launched from) with no caching,
# so edits show up on a normal reload.
import functools, http.server, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
root = os.path.dirname(os.path.abspath(__file__))
print(f'Serving {root} at http://localhost:8765')
http.server.ThreadingHTTPServer(('', 8765), functools.partial(H, directory=root)).serve_forever()
