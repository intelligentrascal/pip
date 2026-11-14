#!/usr/bin/env python3
"""Launch the Mac app with isolated state and fail on a bounded native event deadline.
Keyboard entry uses Pip's own AppKit event queue, never DOM writes or global injection.
No Accessibility, Screen Recording, account, signing or personal native-data access.
"""
import json, os, pathlib, subprocess, tempfile, time
root = pathlib.Path(__file__).resolve().parents[1]
output = pathlib.Path(os.environ['PIP_PROBE_OUTPUT']).resolve()
if output.is_relative_to(root):
    raise SystemExit('Keep native evidence outside the working copy.')
output.mkdir(parents=True, exist_ok=True)
if (output / 'native-probe.json').exists():
    raise SystemExit('Use a fresh evidence folder; a prior result must never satisfy this run.')
scenario = os.environ.get('PIP_PROBE_SCENARIO', 'focus')
if scenario not in ['focus', 'owned-fullscreen', 'tracker', 'art', 'art-diagnostic']:
    raise SystemExit('This gate supports focus, owned full-screen, tracker or native artwork observation only.')
home = pathlib.Path(tempfile.mkdtemp(prefix='pip-native-', dir=os.environ.get('PIP_TEST_ROOT')))
(home / '.pip-test-home').write_text('pip-test-only')
settings = {'PIP_HOME': str(home), 'PIP_TEST': '1', 'PIP_PROBE_OUTPUT': str(output),
            'PIP_CLAUDE_ALLOWED': '', 'PIP_SHOW_ON_LAUNCH': '',
            'PIP_PROBE_METADATA_ONLY': os.environ.get('PIP_PROBE_METADATA_ONLY', ''),
            'PIP_PROBE_OBSERVE_DISPATCH': os.environ.get('PIP_PROBE_OBSERVE_DISPATCH', ''), 'PIP_PROBE_SCENARIO': scenario}
app = root / 'build/Pip.app'
command = ['/usr/bin/open', '-n', '-W']
for key, value in settings.items():
    command.extend(['--env', key + '=' + value])
command.extend(['--stdout', str(output / 'app-stdout.txt'), '--stderr', str(output / 'app-stderr.txt'), str(app)])
result = {'command': command, 'state': str(home), 'launch': 'LaunchServices', 'deadlineSeconds': 40}
start = time.monotonic()
try:
    launch = subprocess.run(command, check=True, timeout=40, capture_output=True, text=True)
    facts = json.loads((output / 'native-probe.json').read_text())
    result['facts'] = facts
    required = ['hotkeyRegistered', 'panelCanBecomeKey', 'panelIsKey', 'allSpaces', 'fullScreenAuxiliary',
                'composerFocused', 'hideWorked', 'draftSurvivedHide', 'providerNotAllowedVisible',
                'resummonPanelIsKey', 'typedInitially', 'typedAfterResummon', 'nativeEscapeHide', 'nativeReturnSubmitted']
    if scenario == 'art':
        required.append('nativeArtObserved')
    if scenario == 'tracker':
        required.extend(['feedbackSavedToBacklog', 'feedbackDidNotStartWork', 'trackerFoundSavedFeedback', 'shortcutSettingApplied'])
    if scenario == 'owned-fullscreen':
        required.extend(['ownedFullScreenEntered', 'panelOnOwnedFullScreenSpace', 'resummonOnOwnedFullScreenSpace', 'ownedFullScreenExited'])
    failures = [name for name in required if facts.get(name) is not True]
    if facts.get('failure'):
        failures.append(facts['failure'])
    result['assertionFailures'] = failures
    assert not failures, failures
    assert facts.get('nativeInputEventCount', 0) > 0, 'No native input events reached WebKit'
    result['outcome'] = 'diagnostic' if scenario == 'art-diagnostic' else 'pass'
finally:
    result['seconds'] = round(time.monotonic() - start, 3)
    (output / 'launch-result.json').write_text(json.dumps(result, indent=2) + '\n')
    # On an interrupted launcher, stop only the exact isolated app that wrote this run's PID.
    if 'outcome' not in result and (output / 'native-probe-process.json').exists():
        pid = json.loads((output / 'native-probe-process.json').read_text())['pid']
        executable = subprocess.run(['ps', '-p', str(pid), '-o', 'comm='], capture_output=True, text=True, timeout=5).stdout.strip()
        if executable == str(app / 'Contents/MacOS/Pip'):
            os.kill(pid, 15)
print(json.dumps(result, indent=2))
