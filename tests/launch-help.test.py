#!/usr/bin/env python3
"""ELF-28 accepted intent: source-launch help must match configurable shortcuts/Allow.

Exercise the launch interface with a real built-app directory, intercepting only
native opening so this deterministic check cannot take the shared native window.
"""
import contextlib
import io
import os
import pathlib
import runpy
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]

class LaunchHelp(unittest.TestCase):
    def test_launch_handoff_and_help(self):
        app = ROOT / 'build/Pip.app'
        self.assertTrue(app.is_dir(), 'Run npm run build before checking the source-launch handoff')
        fixture = pathlib.Path(tempfile.mkdtemp(prefix='pip-launch-help-', dir=os.environ.get('PIP_TEST_ROOT')))
        (fixture / 'scripts').mkdir()
        (fixture / 'build').mkdir()
        (fixture / 'build/Pip.app').symlink_to(app, target_is_directory=True)
        shutil.copyfile(ROOT / 'scripts/launch.py', fixture / 'scripts/launch.py')
        output = io.StringIO()
        with patch.object(subprocess, 'run') as opening, contextlib.redirect_stdout(output):
            runpy.run_path(str(fixture / 'scripts/launch.py'), run_name='__main__')
        opening.assert_called_once_with(['open', str(fixture / 'build/Pip.app')], check=True, timeout=15)
        text = output.getvalue()
        self.assertIn('Command-Shift shortcut configured in Settings', text)
        self.assertIn('choose Summon Pip in the menu bar', text)
        self.assertNotIn('Command-Shift-Space', text)
        self.assertIn('Normal provider use needs Allow in Settings.', text)
        self.assertIn('Developer live checks require separate consent.', text)
        self.assertNotIn('Claude stays disabled', text)

if __name__ == '__main__':
    unittest.main()
