"""Rehearsals for the packaged Pip app, run in disposable folders and isolated Pip homes. Called by scripts/release.py rehearse.

launch: the app from the verified ZIP starts on its own (no Node on PATH, no source tree) and its bundled Node runs the service.
update: the updater, end to end, against a feed made and signed here with a throwaway key: a good update replaces the app and
        relaunches it with saved work untouched; a tampered download, a feed signed by another key, a Homebrew copy and an
        up-to-date copy each leave the app as it was.
Nothing here uses the person's Pip home, accounts, Keychain, signing identity or the network."""
import json, os, pathlib, plistlib, shutil, subprocess, sys, tempfile, threading, time


def run(args, ROOT, RELEASE, artifact_names, execute):
    output = pathlib.Path(args.output).resolve()
    if output.is_relative_to(ROOT):
        sys.exit('Keep rehearsal evidence outside the working copy.')
    output.mkdir(parents=True, exist_ok=True)
    folder = pathlib.Path(args.folder).resolve()
    manifest = json.loads((folder / 'release-manifest.json').read_text())
    zip_path = folder / artifact_names(manifest['version'])[0]
    work = pathlib.Path(tempfile.mkdtemp(prefix='pip-rehearse-', dir=os.environ.get('PIP_TEST_ROOT')))
    results = {}
    try:
        if args.only in (None, 'launch'):
            results['launch'] = launch(ROOT, zip_path, work, output, execute)
        if args.only in (None, 'update'):
            results['update'] = update(ROOT, zip_path, manifest['version'], work, output, execute, getattr(args, 'scenario', None))
    finally:
        subprocess.run(['pkill', '-f', str(work)], capture_output=True)
        shutil.rmtree(work, ignore_errors=True)
        (output / 'rehearsal-result.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))


def extract(zip_path, destination, execute):
    destination.mkdir(parents=True)
    execute(['ditto', '-x', '-k', zip_path, destination])
    return destination / 'Pip.app'


def running_under(prefix):
    listing = subprocess.run(['ps', '-axo', 'command='], capture_output=True, text=True).stdout.splitlines()
    return [line for line in listing if line.startswith(prefix)]


def launch(ROOT, zip_path, work, output, execute):
    app = extract(zip_path, work / 'launch/Applications', execute)
    evidence = output / 'launch'
    shutil.rmtree(evidence, ignore_errors=True)
    environment = {**os.environ, 'PATH': '/usr/bin:/bin', 'PIP_APP': str(app), 'PIP_PROBE_OUTPUT': str(evidence), 'PIP_TEST_ROOT': str(work)}
    process = subprocess.Popen([sys.executable, str(ROOT / 'scripts/validate-native.py')], env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    node = str(app / 'Contents/MacOS/node')
    service = []
    deadline = time.monotonic() + 45
    while process.poll() is None and time.monotonic() < deadline:
        service = [line for line in running_under(node) if 'runtime/service.js' in line]
        if service:
            break
        time.sleep(0.25)
    log, _ = process.communicate(timeout=60)
    outcome = json.loads((evidence / 'launch-result.json').read_text()).get('outcome') if (evidence / 'launch-result.json').exists() else None
    result = {'bundledNodeRanService': bool(service), 'serviceCommand': service[0].replace(str(work), '<disposable>') if service else None,
              'pathDuringLaunch': environment['PATH'], 'nativeProbe': outcome, 'exit': process.returncode}
    if process.returncode != 0 or not service or outcome != 'pass':
        sys.exit('Launch rehearsal failed:\n' + json.dumps(result, indent=2) + '\n' + log[-2000:])
    return result


def node_tool(ROOT, *arguments):
    return subprocess.run(['node', '--import', 'tsx', str(ROOT / 'scripts/update-feed.ts'), *map(str, arguments)], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def next_version(version):
    head, _, tail = version.partition('-')
    identifier, dot, number = tail.rpartition('.')
    return f'{head}-{identifier}.{int(number) + 1}' if number.isdigit() else head + '-next.1'


def bump(app, version):
    path = app / 'Contents/Info.plist'
    info = plistlib.loads(path.read_bytes())
    info['CFBundleShortVersionString'] = info['CFBundleVersion'] = version
    path.write_bytes(plistlib.dumps(info))
    if (app / 'Contents/_CodeSignature').exists():
        # Changing a signed app's Info.plist breaks its seal and macOS then refuses to launch it. Re-seal the outer app ad hoc,
        # keeping its entitlements and hardened-runtime flag, so the rehearsal's stand-in "newer release" still starts.
        subprocess.run(['codesign', '--force', '--sign', '-', '--preserve-metadata=entitlements,flags', str(app)], check=True, capture_output=True)


def version_of(app):
    return plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']


def wait_for(path, wanted, seconds=75):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if path.exists() and path.read_text().strip() == wanted:
            return True
        time.sleep(0.25)
    return False


def photograph(folder, finished):
    """Pip writes the window number of each alert it shows; capture exactly that window (never the screen) while it is up."""
    while not finished.is_set():
        for marker in folder.glob('*.window'):
            picture = marker.with_suffix('.png')
            if not picture.exists():
                subprocess.run(['/usr/sbin/screencapture', '-x', '-o', '-l', marker.read_text().strip(), str(picture)], capture_output=True)
        time.sleep(0.1)
    for marker in folder.glob('*.window'):
        marker.unlink()


def update(ROOT, zip_path, current, work, output, execute, only=None):
    upcoming = next_version(current)
    evidence = output / 'update'
    shutil.rmtree(evidence, ignore_errors=True)
    evidence.mkdir(parents=True)
    results = {}

    def scenario(name, expected, outcome_checks, signed_for_app=True, tamper=False, feed_current_only=False, homebrew=False):
        base = work / ('update-' + name)
        app = extract(zip_path, base / 'Applications', execute)
        home = base / 'home'
        home.mkdir(parents=True)
        (home / '.pip-test-home').write_text('pip-test-only')
        (home / 'sentinel.txt').write_text('saved work stays')
        brew = base / 'brew'
        brew.mkdir()
        if homebrew:
            (brew / 'Caskroom/pip-house-elf' / current).mkdir(parents=True)
        key_folder = base / 'keys'
        public = node_tool(ROOT, 'keygen', '--out', key_folder)
        other_public = node_tool(ROOT, 'keygen', '--out', base / 'other-keys')
        newer = extract(zip_path, base / 'next', execute)
        bump(newer, upcoming)
        archive = base / 'feed' / f'Pip-{upcoming}-arm64.zip'
        archive.parent.mkdir()
        execute(['ditto', '-c', '-k', '--keepParent', newer, archive])
        version, file = (current, zip_path) if feed_current_only else (upcoming, archive)
        node_tool(ROOT, 'add', '--feed', archive.parent / 'feed.json', '--key', key_folder / 'pip-update-signing-key.txt', '--zip', file, '--version', version, '--channel', 'alpha',
                  '--minimum-system', '14.0', '--architecture', 'arm64', '--url', file.as_uri(), '--notes', 'Rehearsal release.', '--test-only', 'yes')
        if tamper:
            data = bytearray(archive.read_bytes())
            data[len(data) // 2] ^= 0xff
            archive.write_bytes(bytes(data))
        result_file = base / 'result.txt'
        environment = {'PIP_HOME': str(home), 'PIP_TEST': '1', 'PIP_TEST_ROOT': str(base), 'PIP_UPDATE_FEED_URL': (archive.parent / 'feed.json').as_uri(),
                       'PIP_UPDATE_PUBLIC_KEY': public if signed_for_app else other_public, 'PIP_UPDATE_CHECK_ON_LAUNCH': '1', 'PIP_UPDATE_AUTO_CONSENT': '1',
                       'PIP_UPDATE_RESULT': str(result_file), 'PIP_UPDATE_HOMEBREW_PREFIX': str(brew)}
        shots = output / 'snapshots' / name
        shutil.rmtree(shots, ignore_errors=True)
        shots.mkdir(parents=True)
        environment['PIP_UPDATE_SNAPSHOT_DIR'] = str(shots)
        command = ['/usr/bin/open', '-n']
        for key, value in environment.items():
            command += ['--env', f'{key}={value}']
        command.append(str(app))
        execute(command)
        capturing = threading.Event()
        photographer = threading.Thread(target=photograph, args=(shots, capturing), daemon=True)
        photographer.start()
        reached = wait_for(result_file, expected)
        facts = {'expectedResult': expected, 'reached': reached, 'finalResult': result_file.read_text().strip() if result_file.exists() else None,
                 'installedVersion': version_of(app), 'savedWorkIntact': (home / 'sentinel.txt').read_text() == 'saved work stays'}
        if reached:
            time.sleep(1.5)
            facts.update(outcome_checks(app, home, upcoming, current))
        capturing.set()
        photographer.join()
        subprocess.run(['pkill', '-f', str(base)], capture_output=True)
        time.sleep(0.5)
        results[name] = facts
        (evidence / f'{name}.json').write_text(json.dumps(facts, indent=2) + '\n')

    def unchanged(app, home, upcoming, current):
        return {'versionUnchanged': version_of(app) == current, 'noLeftovers': not (home / 'updates/staging').exists() and not pathlib.Path(str(app) + '.previous').exists()}

    def replaced(app, home, upcoming, current):
        log = home / 'updates/install.log'
        deadline = time.monotonic() + 30  # the installer finishes a moment after the new app reports its start
        while time.monotonic() < deadline and not (log.exists() and 'Updated.' in log.read_text()):
            time.sleep(0.25)
        text = log.read_text() if log.exists() else ''
        return {'versionReplaced': version_of(app) == upcoming, 'launchMarker': (home / 'updates' / f'launched-{upcoming}').exists(),
                'oldCopyRemoved': not pathlib.Path(str(app) + '.previous').exists(), 'installerLogSaysUpdated': 'Updated.' in text,
                'installerLog': [line.split(' ', 1)[1] for line in text.splitlines() if ' ' in line]}

    plan = [('good-update', 'up-to-date', replaced, {}), ('up-to-date', 'up-to-date', unchanged, {'feed_current_only': True}),
            ('tampered-download', 'install-failed', unchanged, {'tamper': True}), ('wrong-key', 'check-failed', unchanged, {'signed_for_app': False}),
            ('homebrew-copy', f'homebrew:{upcoming}', unchanged, {'homebrew': True})]
    for name, expected, checks, options in plan:
        if only is None or name == only:
            scenario(name, expected, checks, **options)
    failures = [f'{name}: {key}' for name, facts in results.items() for key, value in facts.items() if value is False]
    for name, facts in results.items():
        if not facts['reached']:
            failures.append(f'{name}: never reached {facts["expectedResult"]} (last: {facts["finalResult"]})')
    if failures:
        sys.exit('Update rehearsal failed:\n- ' + '\n- '.join(failures))
    return results
