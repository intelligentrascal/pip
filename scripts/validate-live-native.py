#!/usr/bin/env python3
"""Only after task-scoped consent for a live model: two real native writing turns, with restart.
Each normal Mac-app launch uses explicit isolated state. No sends/native-data writes,
credential access, signing, global keyboard injection or permission requests.
"""
import json, os, pathlib, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parents[1]
if os.environ.get('PIP_LIVE_MODEL_ALLOWED')!='1':
    raise SystemExit('This live check needs the captain’s task-scoped approval for a live model.')
base=pathlib.Path(os.environ['PIP_PROBE_OUTPUT']).resolve()
if base.is_relative_to(root): raise SystemExit('Keep evidence outside the working copy.')
base.mkdir(parents=True,exist_ok=False)
home=pathlib.Path(tempfile.mkdtemp(prefix='pip-live-native-',dir=os.environ.get('PIP_TEST_ROOT')))
(home/'.pip-test-home').write_text('pip-test-only')
app=root/'build/Pip.app'
results=[]
for scenario in ['live-writing','live-followup']:
    output=base/scenario;output.mkdir()
    settings={'PIP_HOME':str(home),'PIP_TEST':'1','PIP_PROBE_OUTPUT':str(output),'PIP_LIVE_MODEL_ALLOWED':'1','PIP_SHOW_ON_LAUNCH':'','PIP_PROBE_METADATA_ONLY':'1','PIP_PROBE_OBSERVE_DISPATCH':'1','PIP_PROBE_SCENARIO':scenario}
    command=['/usr/bin/open','-n','-W']
    for k,v in settings.items():command.extend(['--env',k+'='+v])
    command.extend(['--stdout',str(output/'app-stdout.txt'),'--stderr',str(output/'app-stderr.txt'),str(app)])
    with (output/'launch.json').open('w') as file:json.dump({'command':command,'state':str(home),'deadlineSeconds':40},file,indent=2)
    try:
        subprocess.run(command,check=True,timeout=40,capture_output=True,text=True)
        facts=json.loads((output/'native-probe.json').read_text())
        required=['panelIsKey','resummonPanelIsKey','draftSurvivedHide','typedInitially','typedAfterResummon','nativeEscapeHide','nativeReturnSubmitted','liveDraftVisible','preCallIdentityMatched','generatedDraftPictureSaved']
        if scenario=='live-followup':required.append('selectedContextPreserved')
        failures=[k for k in required if facts.get(k) is not True]
        if facts.get('failure'):failures.append(facts['failure'])
        assert not failures,failures
        results.append({'scenario':scenario,'pass':True,'facts':facts,'draft':json.loads((output/'native-live-draft.json').read_text())})
    finally:
        process_file=output/'native-probe-process.json'
        if process_file.exists():
            pid=json.loads(process_file.read_text())['pid']
            executable=subprocess.run(['ps','-p',str(pid),'-o','comm='],capture_output=True,text=True,timeout=5).stdout.strip()
            if executable==str(app/'Contents/MacOS/Pip'):os.kill(pid,15)
assert results[1]['draft']['contextWorkId']==results[0]['draft']['workId']
assert results[1]['draft']['threadId']==results[0]['draft']['threadId']
(base/'live-writing-verified.json').write_text(json.dumps({'passes':2,'sameIsolatedHome':True,'nativeAppRestarted':True,'results':results},indent=2)+'\n')
print('Two native live writing turns passed across restart; generated drafts are in the evidence folder.')
