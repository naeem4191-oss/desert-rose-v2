# Local dev server: no caching, so edits show up on reload.
import http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
http.server.ThreadingHTTPServer(('', 8765), H).serve_forever()
