#!/usr/bin/env python3
"""Launch locally without installing, signing, requesting access or registering login items."""
import os, pathlib, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[1]
app = root / 'build/Pip.app'
if not app.exists():
    sys.exit('Run npm run build first.')
# open returns immediately; Pip itself is the requested long-lived application.
subprocess.run(['open', str(app)], check=True, timeout=15)
print('Pip launched. Use the Command-Shift shortcut configured in Settings, or choose Summon Pip in the menu bar.')
print('No login item is installed. Normal provider use needs Allow in Settings. Developer live checks require separate consent.')
