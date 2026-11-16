#!/usr/bin/env python3
"""Hidden native-app private-pipe check. Isolated files only; no keyboard or system data."""
import json, os, pathlib, subprocess, tempfile, uuid, select, time, errno
root=pathlib.Path(__file__).resolve().parents[1]
output=pathlib.Path(os.environ['PIP_BACKEND_PROBE_OUTPUT']).resolve()
if output.is_relative_to(root):raise SystemExit('Keep evidence outside the working copy.')
output.mkdir(parents=True,exist_ok=False)
count=int(os.environ.get('PIP_BACKEND_RUNS','1'))
if not 1<=count<=10:raise SystemExit('Use one to ten bounded runs.')
sandbox=pathlib.Path(os.environ['PIP_TEST_ROOT']).resolve();sandbox.mkdir(parents=True,exist_ok=True)
app=root/'build/Pip.app'
results=[]
for index in range(1,count+1):
    evidence=output/f'run-{index:02}';evidence.mkdir()
    home=pathlib.Path(tempfile.mkdtemp(prefix='pip-backend-app-',dir=sandbox));(home/'.pip-test-home').write_text('pip-test-only')
    targets=[{'id':str(uuid.uuid4()),'title':'Fixture reminders','kind':'reminder','writable':True,'revision':str(uuid.uuid4())}]
    (home/'backend-seed.json').write_text(json.dumps({'targets':targets,'objects':[],'access':True,'notificationPermission':'granted'}))
    settings={'PIP_TEST':'1','PIP_HOME':str(home),'PIP_TEST_ROOT':str(sandbox),'PIP_ISOLATED_BACKENDS':'1','PIP_BACKEND_PROBE_OUTPUT':str(evidence),'PIP_SHOW_ON_LAUNCH':'','PIP_PROBE_OUTPUT':''}
    command=['/usr/bin/open','-n','-W']
    for key,value in settings.items():command.extend(['--env',key+'='+value])
    command.extend(['--stdout',str(evidence/'app-stdout.txt'),'--stderr',str(evidence/'app-stderr.txt'),str(app)])
    (evidence/'launch.json').write_text(json.dumps({'command':command,'state':str(home),'deadlineSeconds':30},indent=2))
    # Observe this task-owned evidence directory before launch. LaunchServices -W
    # can return while the new app is still alive; it is not a completion signal.
    directory_fd=os.open(evidence,os.O_RDONLY)
    notifications=select.kqueue()
    notifications.control([select.kevent(directory_fd,filter=select.KQ_FILTER_VNODE,flags=select.KQ_EV_ADD|select.KQ_EV_CLEAR,fflags=select.KQ_NOTE_WRITE)],0,0)
    deadline=time.monotonic()+30
    try:
        subprocess.run(command,check=True,timeout=30,capture_output=True,text=True)
        if os.environ.get('PIP_BACKEND_DIAGNOSTIC')=='1':
            pidfile=evidence/'backend-process.json';alive=False
            if pidfile.exists():
                pid=json.loads(pidfile.read_text())['pid']
                try:os.kill(pid,0);alive=True
                except ProcessLookupError:pass
            (evidence/'launch-observation.json').write_text(json.dumps({'nativePIDRecorded':pidfile.exists(),'nativeStillAliveAfterOpenReturned':alive,'proofExistsAfterOpenReturned':(evidence/'backend-app-proof.json').exists()},indent=2)+'\n')
        proof_file=evidence/'backend-app-proof.json'
        while not proof_file.exists():
            remaining=deadline-time.monotonic()
            if remaining<=0 or not notifications.control(None,1,remaining):raise TimeoutError('Native app did not publish its protocol result before the deadline')
        proof=json.loads(proof_file.read_text())
        # Wait for this exact owned process to exit, not another app with its bundle ID.
        pid=json.loads((evidence/'backend-process.json').read_text())['pid']
        exits=select.kqueue()
        try:
            try:exits.control([select.kevent(pid,filter=select.KQ_FILTER_PROC,flags=select.KQ_EV_ADD|select.KQ_EV_ONESHOT,fflags=select.KQ_NOTE_EXIT)],0,0)
            except ProcessLookupError:pass
            except OSError as error:
                if error.errno!=errno.ESRCH:raise
            else:
                remaining=deadline-time.monotonic()
                if remaining<=0 or not exits.control(None,1,remaining):raise TimeoutError('Owned native app did not exit before the deadline')
        finally:exits.close()
        assert proof.get('nativeAppPrivateBridge') is True and not proof.get('failure'),proof
        assert proof['systemStoreConstructed'] is False and proof['keyboardUsed'] is False
        state=json.loads((home/'schedule-fixture.json').read_text())
        assert len(state['objects'])==1 and state['objects'][0]['correlation']==proof['proposal'] and state['objects'][0]['id']==proof['nativeObject']
        results.append(proof)
        print(f'Hidden native app backend: pass {index}/{count}',flush=True)
    finally:
        notifications.close();os.close(directory_fd)
        pidfile=evidence/'backend-process.json'
        if pidfile.exists():
            pid=json.loads(pidfile.read_text())['pid']
            actual=subprocess.run(['ps','-p',str(pid),'-o','comm='],capture_output=True,text=True,timeout=5).stdout.strip()
            if actual==str(app/'Contents/MacOS/Pip'):os.kill(pid,15)
(output/'verified.json').write_text(json.dumps({'passes':len(results),'results':results,'isolatedOnly':True},indent=2)+'\n')
