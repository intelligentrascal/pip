#!/usr/bin/env python3
"""ELF-26: run only after task-scoped ChatGPT consent; captain signs in in Pip.
Sign-in and the one bounded draft request are separate phases. No credentials
are read by this launcher, no Keychain, no signing, no production profile or permissions.
"""
import json, os, pathlib, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
if os.nice(0)<19:os.nice(19-os.nice(0))
if os.environ.get('PIP_CHATGPT_LIVE_ALLOWED')!='1':
    raise SystemExit('This check requires the captain’s task-scoped ChatGPT approval.')
output=pathlib.Path(os.environ['PIP_PROBE_OUTPUT']).resolve()
if output.is_relative_to(root): raise SystemExit('Keep evidence outside the working copy.')
output.mkdir(parents=True,exist_ok=False)
test_root=pathlib.Path(os.environ['PIP_TEST_ROOT']).resolve()
existing=os.environ.get('PIP_CHATGPT_TEST_HOME')
if existing:
    home=pathlib.Path(existing).resolve()
    if not home.is_relative_to(test_root) or (home/'.pip-test-home').read_text().strip()!='pip-test-only':
        raise SystemExit('Draft proof requires the same marked, isolated sign-in profile under the test root.')
    scenario='chatgpt-draft'
else:
    home=pathlib.Path(tempfile.mkdtemp(prefix='pip-chatgpt-',dir=test_root))
    (home/'.pip-test-home').write_text('pip-test-only')
    scenario='chatgpt'
settings={'PIP_HOME':str(home),'PIP_TEST':'1','PIP_PROBE_OUTPUT':str(output),'PIP_CLAUDE_ALLOWED':'','PIP_SHOW_ON_LAUNCH':'','PIP_PROBE_SCENARIO':scenario,'PIP_CHATGPT_LIVE_ALLOWED':'1'}
command=['/usr/bin/open','-n','-W']
for k,v in settings.items():command.extend(['--env',k+'='+v])
command.extend(['--stdout',str(output/'app-stdout.txt'),'--stderr',str(output/'app-stderr.txt'),str(root/'build/Pip.app')])
(output/'launch.json').write_text(json.dumps({'command':command,'isolatedHome':str(home),'deadlineSeconds':620,'launcherNice':os.nice(0)},indent=2))
try:
    subprocess.run(command,check=True,timeout=620,capture_output=True,text=True)
    facts=json.loads((output/'native-probe.json').read_text())
    required=['chatGPTConnectedInPip','chatGPTSignInComplete'] if scenario=='chatgpt' else ['chatGPTConnectedInPip','chatGPTPrivateSubmitUsed','draftWindowDidNotTakeKey','chatGPTLiveDraftVisible','chatGPTOpenedSourceCited','generatedDraftPictureSaved']
    failures=[k for k in required if facts.get(k) is not True]
    if facts.get('failure'):failures.append(facts['failure'])
    if failures:raise SystemExit('ChatGPT native check failed: '+str(failures))
    print('Pip connected ChatGPT; the separate draft phase can reuse this isolated profile.' if scenario=='chatgpt' else 'Pip reused its saved connection, opened a public source and rendered its editable model-labelled draft without keyboard injection.')
finally:
    process_file=output/'native-probe-process.json'
    if process_file.exists():
        pid=json.loads(process_file.read_text())['pid']
        executable=subprocess.run(['ps','-p',str(pid),'-o','comm='],capture_output=True,text=True,timeout=5).stdout.strip()
        if executable==str(root/'build/Pip.app/Contents/MacOS/Pip'):os.kill(pid,15)
