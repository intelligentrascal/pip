#!/usr/bin/env python3
"""Ten independent native acceptance runs, no retries; stop at the first failure.
Each run has fresh explicit state and evidence. Total worst-case deadline < 10 minutes.
"""
import os, pathlib, subprocess, sys, time
root = pathlib.Path(__file__).resolve().parents[1]
base = pathlib.Path(os.environ['PIP_PROBE_OUTPUT']).resolve()
base.mkdir(parents=True, exist_ok=True)
started = time.monotonic()
for index in range(1, 11):
    output = base / f'native-{index:02}'
    env = os.environ.copy()
    env['PIP_PROBE_OUTPUT'] = str(output)
    with (base / f'native-{index:02}.txt').open('w') as log:
        result = subprocess.run([sys.executable, str(root / 'scripts/validate-native.py')],
                                env=env, stdout=log, stderr=subprocess.STDOUT, timeout=45)
    if result.returncode:
        sys.exit(f'Native acceptance failed on run {index}; stopped with no retry.')
    print(f'Native acceptance: pass {index}/10', flush=True)
    if time.monotonic() - started > 490:
        sys.exit('Native acceptance exceeded its overall deadline.')
