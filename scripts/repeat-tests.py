#!/usr/bin/env python3
"""Run each affected suite ten times without retries. Stop on the first failure."""
import os, pathlib, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[1]
output = pathlib.Path(os.environ['PIP_TEST_LOGS'])
output.mkdir(parents=True, exist_ok=True)
commands = {'host': ['npm', 'run', 'check'], 'native': ['swift', 'run', 'PipCoreChecks'], 'ui': ['npm', 'run', 'test:ui']}
for suite in sys.argv[1:] or commands:
    for index in range(1, 11):
        env = os.environ.copy()
        if index != 1:
            env.pop('PIP_CAPTURE_DIR', None)
        with (output / f'{suite}-{index:02}.txt').open('w') as log:
            result = subprocess.run(commands[suite], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=120)
        if result.returncode:
            sys.exit(f'{suite} failed on pass {index}; stopped, no retry.')
        print(f'{suite}: pass {index}/10', flush=True)
