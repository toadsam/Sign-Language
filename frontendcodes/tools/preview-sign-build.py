#!/usr/bin/env python3
"""Loopback-only preview for Expo static export with its configured path prefix."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, export_root, base_path, **kwargs):
        self.export_root = Path(export_root).resolve()
        self.base_path = base_path
        super().__init__(*args, directory=str(self.export_root), **kwargs)

    def translate_path(self, path):
        url_path = unquote(urlsplit(path).path)
        if url_path != self.base_path and not url_path.startswith(self.base_path + '/'):
            return str(self.export_root / '__outside_base_path__')
        relative = url_path[len(self.base_path):].lstrip('/')
        parts = Path(relative).parts
        if any(part.startswith('.') for part in parts):
            return str(self.export_root / '__invalid_path__')
        target = (self.export_root / relative).resolve()
        if not target.is_relative_to(self.export_root):
            return str(self.export_root / '__invalid_path__')
        if target.is_dir():
            target = target / 'index.html'
        elif not target.suffix and target.with_suffix('.html').is_file():
            target = target.with_suffix('.html')
        return str(target)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='Expo export output directory')
    parser.add_argument('--port', type=int, default=8084)
    parser.add_argument('--base-path', default='/Sign-Language')
    args = parser.parse_args()
    root = args.directory.resolve()
    base = '/' + args.base_path.strip('/')
    if not (root / 'index.html').is_file() or not (root / '_expo').is_dir():
        parser.error('Expo export directory with index.html and _expo is required')
    if base == '/' or any(part.startswith('.') for part in Path(base).parts[1:]):
        parser.error('Use a non-empty path prefix without dot segments')
    if not 1 <= args.port <= 65535:
        parser.error('port must be in 1..65535')
    handler = partial(PreviewHandler, export_root=root, base_path=base)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    print(f'Local build preview: http://127.0.0.1:{args.port}{base}/sign-lab', flush=True)
    print('No public hosting or authentication changes. Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
