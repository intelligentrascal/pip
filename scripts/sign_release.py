#!/usr/bin/env python3
"""Sign, notarize and staple the packaged Pip app, then make the final ZIP and DMG. Local only.

  sign      sign the nested code and the app, notarize and staple the app, package it, then sign, notarize and staple the DMG
  inspect   check a signed package folder the way a person's Mac does: signature, hardened runtime, entitlements, tickets, Gatekeeper

Run it only after the maintainer has agreed to use their Developer ID certificate and to send these two files to Apple.
The certificate is named by --identity (a name or hash shown by `security find-identity`); Apple credentials come from a
notarytool Keychain profile the maintainer stored themselves (--notary-profile). No password, key or token is ever read by
this script, printed, or placed on a command line. Each Apple submission is written to the journal the moment Apple
answers with its id, so an interrupted run is resumed with --resume rather than submitted twice.
"""
import argparse, json, os, pathlib, plistlib, re, shutil, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import release  # noqa: E402

ENTITLEMENTS = ROOT / 'release/entitlements'
NODE_ENTITLEMENTS = ENTITLEMENTS / 'node.entitlements.plist'
APP_ENTITLEMENTS = ENTITLEMENTS / 'pip.entitlements.plist'
SIGNED_APP = ROOT / 'build/release/signed/Pip.app'
JOURNAL_NAME = 'notarization-journal.json'


class Failure(SystemExit):
    pass


def say(text):
    print(text, flush=True)


def tool(command, check=True, **options):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True, **options)
    if check and result.returncode != 0:
        raise Failure(f'{command[0]} {command[1] if len(command) > 1 else ""} failed ({result.returncode}):\n{(result.stderr or result.stdout).strip()}')
    return result


def nested_code(app):
    """Every Mach-O inside the app except the app's own executable, deepest first, so each is signed before what contains it."""
    files = [path for path in app.rglob('*') if path.is_file() and not path.is_symlink() and release.is_mach_o(path)]
    main = app / 'Contents/MacOS/Pip'
    return sorted((path for path in files if path != main), key=lambda path: (-len(path.parts), path.as_posix()))


def sign_one(identity, target, entitlements=None, runtime=True):
    command = ['codesign', '--force', '--timestamp', '--sign', identity]
    if runtime:
        command += ['--options', 'runtime']
    if entitlements:
        command += ['--entitlements', entitlements]
    tool(command + [target])


def sign_app(identity, app):
    for path in nested_code(app):
        sign_one(identity, path, NODE_ENTITLEMENTS if path.name == 'node' else None)
    sign_one(identity, app, APP_ENTITLEMENTS)
    tool(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app])


def read_journal(journal):
    return json.loads(journal.read_text()) if journal.exists() else {}


def write_journal(journal, data):
    journal.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')


def notarize(profile, file, label, digest, journal, log_folder):
    """Submit one file to Apple, or pick up the earlier submission of the same content, and return only when Apple has accepted it.
    `digest` names the content: the app's tree hash (a ZIP of it is not byte-stable) or the DMG's SHA-256."""
    data = read_journal(journal)
    entry = data.get(label)
    if entry and entry['sha256'] != digest:
        raise Failure(f'The journal holds a submission of {label} with different bytes ({entry["id"]}). Check it with `notarytool info` and delete the entry only if it is abandoned.')
    if not entry:
        say(f'Submitting {label} ({digest[:12]}…) to Apple notarization')
        started = tool(['xcrun', 'notarytool', 'submit', file, '--keychain-profile', profile, '--output-format', 'json'], check=False)
        try:
            submission = json.loads(started.stdout)['id']
        except (ValueError, KeyError):
            raise Failure(f'Apple did not return a submission id for {label}; its outcome is unknown. Do not resubmit before checking `xcrun notarytool history`.\n{started.stderr.strip()}')
        entry = data[label] = {'id': submission, 'sha256': digest, 'status': 'submitted'}
        write_journal(journal, data)
    say(f'Waiting for Apple to finish {label} ({entry["id"]})')
    waited = tool(['xcrun', 'notarytool', 'wait', entry['id'], '--keychain-profile', profile, '--output-format', 'json'], check=False)
    info = tool(['xcrun', 'notarytool', 'info', entry['id'], '--keychain-profile', profile, '--output-format', 'json'], check=False)
    try:
        status = json.loads(info.stdout)['status']
    except (ValueError, KeyError):
        raise Failure(f'Could not read the outcome of {label} ({entry["id"]}); it stays unknown. Re-run with --resume to read it again.\n{(info.stderr or waited.stderr).strip()}')
    entry['status'] = status
    write_journal(journal, data)
    if status != 'Accepted':
        log = tool(['xcrun', 'notarytool', 'log', entry['id'], '--keychain-profile', profile], check=False)
        log_folder.mkdir(parents=True, exist_ok=True)
        (log_folder / f'{label}-{entry["id"]}.log.json').write_text(log.stdout)
        raise Failure(f'Apple returned "{status}" for {label}; its log is in {log_folder}')
    say(f'Apple accepted {label}')
    return entry['id']


def staple(target):
    tool(['xcrun', 'stapler', 'staple', target])
    tool(['xcrun', 'stapler', 'validate', target])


def describe_signature(target):
    shown = tool(['codesign', '-dvv', target], check=False)
    text = shown.stderr
    team = re.search(r'TeamIdentifier=(\S+)', text)
    authority = re.search(r'Authority=(Developer ID Application:[^\n]+)', text)
    flags = re.search(r'flags=0x([0-9a-f]+)', text)
    return {'teamIdentifier': team.group(1) if team else None, 'authority': authority.group(1) if authority else None,
            'hardenedRuntime': bool(flags) and bool(int(flags.group(1), 16) & 0x10000), 'timestamped': 'Timestamp=' in text}


def write_checksums(folder, manifest):
    for name in manifest['files']:
        manifest['files'][name] = {'sha256': release.sha256(folder / name), 'size': (folder / name).stat().st_size}
    (folder / 'SHA256SUMS').write_text(''.join(f'{entry["sha256"]}  {name}\n' for name, entry in manifest['files'].items()))
    (folder / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


def sign(args):
    unsigned = pathlib.Path(args.app).resolve() if args.app else release.APP_BUILD
    if (unsigned / 'Contents/_CodeSignature').exists():
        raise Failure(f'{unsigned} is already signed; sign a fresh unsigned build')
    faults, _ = release.inspect_app(unsigned, release.version(), strict_paths=[str(ROOT), str(pathlib.Path.home())])
    if faults:
        raise Failure('The app is not self-contained and update-ready:\n- ' + '\n- '.join(faults))
    journal_folder = pathlib.Path(args.journal).resolve()
    journal_folder.mkdir(parents=True, exist_ok=True)
    journal = journal_folder / JOURNAL_NAME
    if journal.exists() and not args.resume:
        raise Failure(f'{journal} exists from an earlier run. Pass --resume to continue it, or move it away if it is abandoned.')
    if args.resume and not journal.exists():
        raise Failure('There is no journal to resume.')
    work = SIGNED_APP.parent
    app = SIGNED_APP
    if args.resume and app.exists():
        say('Resuming with the signed app already on disk')
    else:
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True)
        tool(['ditto', unsigned, app])
        say('Signing nested code, then the app (hardened runtime, secure timestamp)')
        sign_app(args.identity, app)
    with tempfile.TemporaryDirectory(prefix='pip-notarize-') as scratch:
        submission = pathlib.Path(scratch) / 'Pip-for-notarization.zip'
        tool(['ditto', '-c', '-k', '--keepParent', app, submission])
        notarize(args.notary_profile, submission, 'app', release.tree_digest(app), journal, journal_folder)
    staple(app)
    folder = release.ARTIFACTS
    dmg_entry = read_journal(journal).get('dmg')
    dmg_current = args.resume and dmg_entry and any(folder.glob('*.dmg')) and release.sha256(next(folder.glob('*.dmg'))) == dmg_entry['sha256']
    if not dmg_current:
        # Package the stapled, signed app: the ZIP and DMG are made from exactly these bytes. A DMG is not byte-stable, so an
        # interrupted run keeps the one Apple already holds instead of making another.
        tool([sys.executable, ROOT / 'scripts/release.py', 'package', '--app', app])
    manifest = json.loads((folder / 'release-manifest.json').read_text())
    zip_name, dmg_name = release.artifact_names(manifest['version'])
    if not dmg_current:
        sign_one(args.identity, folder / dmg_name, runtime=False)
    notarize(args.notary_profile, folder / dmg_name, 'dmg', release.sha256(folder / dmg_name), journal, journal_folder)
    staple(folder / dmg_name)
    manifest.update({'signed': True, 'notarized': True, 'signature': describe_signature(app)})
    write_checksums(folder, manifest)
    say(f'Signed, notarized and stapled Pip {manifest["version"]} in {folder}')
    inspect_folder(folder)


def entitlements_of(target):
    out = tool(['codesign', '-d', '--entitlements', ':-', target], check=False).stdout
    return plistlib.loads(out.encode()) if out.strip() else {}


def inspect_folder(folder, allow_unsigned=False):
    """Fault list for a signed package folder: used by `inspect` and by `release.py verify` for a published package."""
    folder = pathlib.Path(folder)
    manifest = json.loads((folder / 'release-manifest.json').read_text())
    zip_name, dmg_name = release.artifact_names(manifest['version'])
    faults = []
    if not manifest.get('notarized'):
        faults.append('The manifest does not say the package was notarized')
    work = pathlib.Path(tempfile.mkdtemp(prefix='pip-inspect-'))
    mount = None
    try:
        opened = work / 'zip'
        tool(['ditto', '-x', '-k', folder / zip_name, opened])
        faults += check_app(opened / 'Pip.app', 'ZIP', manifest)
        mount = release.mounted(folder / dmg_name)
        faults += check_app(mount / 'Pip.app', 'DMG', manifest)
        dmg_check = tool(['codesign', '--verify', '--strict', '--verbose=2', folder / dmg_name], check=False)
        if dmg_check.returncode:
            faults.append(f'DMG signature: {dmg_check.stderr.strip()}')
        if tool(['xcrun', 'stapler', 'validate', folder / dmg_name], check=False).returncode:
            faults.append('DMG has no valid notarization ticket')
        gate = tool(['spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', '-vv', folder / dmg_name], check=False)
        if gate.returncode:
            faults.append(f'Gatekeeper refuses the DMG: {gate.stderr.strip()}')
    finally:
        if mount:
            subprocess.run(['hdiutil', 'detach', '-force', str(mount)], capture_output=True)
            shutil.rmtree(mount, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)
    return faults


def check_app(app, label, manifest):
    faults = []
    deep = tool(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app], check=False)
    if deep.returncode:
        faults.append(f'{label}: signature does not verify: {deep.stderr.strip()}')
        return faults
    seen = describe_signature(app)
    if not seen['authority']:
        faults.append(f'{label}: not signed with a Developer ID Application certificate')
    if not seen['hardenedRuntime']:
        faults.append(f'{label}: hardened runtime is not on')
    if not seen['timestamped']:
        faults.append(f'{label}: no secure timestamp')
    expected = manifest.get('signature', {})
    if expected.get('teamIdentifier') and seen['teamIdentifier'] != expected['teamIdentifier']:
        faults.append(f'{label}: team {seen["teamIdentifier"]} is not the manifest\'s {expected["teamIdentifier"]}')
    for path in nested_code(app):
        nested = describe_signature(path)
        if nested['teamIdentifier'] != seen['teamIdentifier'] or not nested['hardenedRuntime'] or not nested['timestamped']:
            faults.append(f'{label}: {path.relative_to(app).as_posix()} is not signed like the app')
    wanted = {'node': plistlib.loads(NODE_ENTITLEMENTS.read_bytes()), 'app': plistlib.loads(APP_ENTITLEMENTS.read_bytes())}
    if entitlements_of(app) != wanted['app']:
        faults.append(f'{label}: the app\'s entitlements are not the reviewed set')
    if entitlements_of(app / 'Contents/MacOS/node') != wanted['node']:
        faults.append(f'{label}: the bundled Node\'s entitlements are not the reviewed set')
    if tool(['xcrun', 'stapler', 'validate', app], check=False).returncode:
        faults.append(f'{label}: the app has no valid notarization ticket')
    gate = tool(['spctl', '--assess', '--type', 'execute', '-vv', app], check=False)
    if gate.returncode:
        faults.append(f'{label}: Gatekeeper refuses the app: {gate.stderr.strip()}')
    return faults


def inspect(args):
    faults = inspect_folder(args.folder)
    if faults:
        raise Failure('Inspection failed:\n- ' + '\n- '.join(faults))
    say('Signature, hardened runtime, timestamps, entitlements, notarization tickets and Gatekeeper all agree for the ZIP\'s app, the DMG\'s app and the DMG.')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('sign')
    p.add_argument('--identity', required=True, help='the Developer ID Application certificate name or hash')
    p.add_argument('--notary-profile', required=True, help='a notarytool Keychain profile the maintainer stored')
    p.add_argument('--journal', required=True, help='an absolute folder outside the working copy that keeps the notarization journal and any Apple logs')
    p.add_argument('--app', help='an unsigned release app instead of build/release/Pip.app')
    p.add_argument('--resume', action='store_true', help='continue after an interruption, reading the journal instead of submitting again')
    p.set_defaults(run=sign)
    p = commands.add_parser('inspect'); p.add_argument('folder'); p.set_defaults(run=inspect)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    main()
