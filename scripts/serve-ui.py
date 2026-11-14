#!/usr/bin/env python3
"""Isolated UI test server, never part of the running native application."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import pathlib, threading, os
root = pathlib.Path(__file__).resolve().parents[1] / 'build/Pip.app/Contents/Resources/web'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PIP_TEST_PORT', '38941'))), Handler)
threading.Timer(590, server.shutdown).start()
server.serve_forever()
