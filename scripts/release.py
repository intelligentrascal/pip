#!/usr/bin/env python3
"""Local release tooling for the self-contained Apple-silicon Pip app. Everything runs on this Mac.

  package   build the release app and make the ZIP, the DMG, SHA256SUMS and release-manifest.json
  verify    check a folder of downloads (or --fetch <base URL> to download them first) the way a person's Mac gets them
  cask      write the Homebrew Cask file for the packaged ZIP
  rehearse  launch the packaged app on its own, and update it end to end in a disposable folder

It never signs, notarizes, publishes, pushes or touches the Keychain. Signing, notarization and the public
release are separate steps that need the captain's own accounts; see docs/RELEASING.md. A package made here
says `signed: false` in its manifest, and `verify` refuses it for publication unless --allow-unsigned is given.
"""
import argparse, hashlib, json, os, pathlib, plistlib, re, shutil, subprocess, sys, tempfile, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
RELEASE = json.loads((ROOT / 'release/release.json').read_text())
NODE = json.loads((ROOT / 'release/node-runtime.json').read_text())
APP_BUILD = ROOT / 'build/release/Pip.app'
ARTIFACTS = ROOT / 'build/release/artifacts'
SYSTEM_LIBRARIES = ('/System/Library/', '/usr/lib/')


def run(command, **options):
    return subprocess.run([str(part) for part in command], check=True, capture_output=True, text=True, **options).stdout


def version():
    return json.loads((ROOT / 'package.json').read_text())['version']


def sha256(file):
    digest = hashlib.sha256()
    with open(file, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_names(release_version):
    stem = f'Pip-{release_version}-{RELEASE["architecture"]}'
    return stem + '.zip', stem + '.dmg'


def is_mach_o(file):
    with open(file, 'rb') as handle:
        return handle.read(4) in (b'\xca\xfe\xba\xbe', b'\xcf\xfa\xed\xfe')


def tree_digest(app):
    """One hash over every path, link target, mode bit that matters and file content, for comparing two copies of the app."""
    digest = hashlib.sha256()
    for path in sorted(app.rglob('*')):
        relative = path.relative_to(app).as_posix()
        if path.is_symlink():
            digest.update(f'L {relative} {os.readlink(path)}\n'.encode())
        elif path.is_file():
            digest.update(f'F {relative} {int(os.access(path, os.X_OK))} {sha256(path)}\n'.encode())
    return digest.hexdigest()


def inspect_app(app, expected_version, strict_paths=(), need_update_key=True):
    """Every fault found in a built Pip.app, as sentences. An empty list means the bundle is self-contained."""
    faults, machos = [], []
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    for key, value in {'CFBundleIdentifier': RELEASE['bundleIdentifier'], 'CFBundleShortVersionString': expected_version, 'CFBundleVersion': expected_version,
                       'LSMinimumSystemVersion': RELEASE['minimumSystemVersion'], 'PipUpdateChannel': RELEASE['channel'], 'PipUpdateFeedURL': RELEASE['updateFeedURL']}.items():
        if info.get(key) != value:
            faults.append(f'Info.plist {key} is {info.get(key)!r}, expected {value!r}')
    if need_update_key and not info.get('PipUpdatePublicKey'):
        faults.append('Info.plist has no PipUpdatePublicKey, so this build cannot check for updates')
    for required in ('Contents/MacOS/Pip', 'Contents/MacOS/node', 'Contents/Resources/Pip.icns', 'Contents/Resources/web/index.html', 'Contents/Resources/runtime/service.js',
                     'Contents/Resources/node_modules/@earendil-works/pi-durable/package.json', 'Contents/Resources/licenses/node/LICENSE', 'Contents/Resources/licenses/THIRD_PARTY_NOTICES.md'):
        if not (app / required).exists():
            faults.append(f'{required} is missing')
    for forbidden in ('Contents/Resources/node-path.txt',):
        if (app / forbidden).exists():
            faults.append(f'{forbidden} (a developer-build file naming this Mac\'s Node) is present')
    for path in app.rglob('*'):
        relative = path.relative_to(app).as_posix()
        if path.is_symlink():
            faults.append(f'{relative} is a symbolic link; a release bundle carries none')
        elif path.is_file() and is_mach_o(path):
            machos.append(path)
        if path.name == '.bin':
            faults.append(f'{relative} should not ship')
    inventory = []
    for file in machos:
        archs = run(['lipo', '-archs', file]).split()
        relative = file.relative_to(app).as_posix()
        linked = [line.split(' (')[0].strip() for line in run(['otool', '-L', file]).splitlines()[1:]]
        outside = [name for name in linked if not name.startswith(SYSTEM_LIBRARIES) and not name.startswith('@rpath/') and not name.startswith('@loader_path/')]
        if archs != ['arm64']:
            faults.append(f'{relative} has slices {archs}, expected only arm64')
        if outside:
            faults.append(f'{relative} links libraries outside macOS: {outside}')
        inventory.append({'path': relative, 'architectures': archs, 'linksOutsideSystem': outside})
    # Own code and data must not name the machine that built them. Strings of the build machine's own paths are searched everywhere.
    candidates = [app / 'Contents/MacOS/Pip', app / 'Contents/Info.plist', *[p for folder in ('runtime', 'web') for p in (app / 'Contents/Resources' / folder).rglob('*') if p.is_file()]]
    for file in candidates:
        data = file.read_bytes()
        for pattern in (b'/Users/', b'/private/var/folders/', b'/tmp/pip-'):
            if pattern in data:
                faults.append(f'{file.relative_to(app).as_posix()} contains the path text {pattern.decode()}')
    for needle in strict_paths:
        encoded = needle.encode()
        for file in app.rglob('*'):
            if file.is_file() and not file.is_symlink() and encoded in file.read_bytes():
                faults.append(f'{file.relative_to(app).as_posix()} names the build location')
    node_output = run([app / 'Contents/MacOS/node', '--version'], env={'PATH': '/usr/bin:/bin'}).strip()
    if node_output != 'v' + NODE['version']:
        faults.append(f'The bundled Node reports {node_output}, expected v{NODE["version"]}')
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    for name, entry in lock['packages'].items():
        if name.startswith('node_modules/') and not entry.get('dev') and not entry.get('optional') and 'node_modules/' not in name[len('node_modules/'):]:
            if not (app / 'Contents/Resources' / name / 'package.json').exists():
                faults.append(f'Production dependency {name} is missing')
    for name in ('typescript', 'tsx', 'esbuild'):
        if (app / 'Contents/Resources/node_modules' / name).exists():
            faults.append(f'Development tool {name} ships in the app')
    return faults, inventory


def package(args):
    release_version = version()
    app = pathlib.Path(args.app).resolve() if args.app else APP_BUILD
    if not args.app:
        subprocess.run(['npx', 'tsc'], cwd=ROOT, check=True, timeout=300)
        subprocess.run([sys.executable, str(ROOT / 'scripts/build.py'), '--release'], cwd=ROOT, check=True, timeout=900)
    faults, inventory = inspect_app(app, release_version, strict_paths=[str(ROOT), str(pathlib.Path.home())] if not args.app else [], need_update_key=not args.rehearsal)
    if faults:
        sys.exit('The app is not self-contained:\n- ' + '\n- '.join(faults))
    zip_name, dmg_name = artifact_names(release_version)
    shutil.rmtree(ARTIFACTS, ignore_errors=True)
    ARTIFACTS.mkdir(parents=True)
    run(['ditto', '-c', '-k', '--keepParent', app, ARTIFACTS / zip_name])
    with tempfile.TemporaryDirectory(prefix='pip-dmg-') as work:
        layout = pathlib.Path(work) / 'layout'
        layout.mkdir()
        run(['ditto', app, layout / 'Pip.app'])
        (layout / 'Applications').symlink_to('/Applications')
        run(['hdiutil', 'create', '-volname', f'Pip {release_version}', '-srcfolder', layout, '-ov', '-format', 'UDZO', '-fs', 'HFS+', ARTIFACTS / dmg_name])
    files = {name: {'sha256': sha256(ARTIFACTS / name), 'size': (ARTIFACTS / name).stat().st_size} for name in (zip_name, dmg_name)}
    (ARTIFACTS / 'SHA256SUMS').write_text(''.join(f'{entry["sha256"]}  {name}\n' for name, entry in files.items()))
    signed = (app / 'Contents/_CodeSignature').exists()
    manifest = {'schema': 1, 'product': 'Pip', 'version': release_version, 'channel': RELEASE['channel'], 'architecture': RELEASE['architecture'],
                'bundleIdentifier': RELEASE['bundleIdentifier'], 'minimumSystemVersion': RELEASE['minimumSystemVersion'], 'node': NODE['version'],
                'signed': signed, 'updatesConfigured': bool(plistlib.loads((app / 'Contents/Info.plist').read_bytes()).get('PipUpdatePublicKey')), 'appTree': tree_digest(app), 'files': files, 'machO': inventory}
    (ARTIFACTS / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Packaged Pip {release_version} (signed: {signed}) in {ARTIFACTS}')
    for name, entry in files.items():
        print(f'  {entry["sha256"]}  {name}  {entry["size"]} bytes')


def fetch_into(base, folder):
    names = ['SHA256SUMS', 'release-manifest.json']
    for name in names:
        with urllib.request.urlopen(f'{base.rstrip("/")}/{name}', timeout=60) as response:
            (folder / name).write_bytes(response.read())
    manifest = json.loads((folder / 'release-manifest.json').read_text())
    for name in manifest['files']:
        with urllib.request.urlopen(f'{base.rstrip("/")}/{name}', timeout=600) as response:
            (folder / name).write_bytes(response.read())


def mounted(dmg):
    mount = pathlib.Path(tempfile.mkdtemp(prefix='pip-mount-'))
    run(['hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen', '-noverify', '-mountpoint', mount, dmg])
    return mount


def verify(args):
    work = pathlib.Path(tempfile.mkdtemp(prefix='pip-verify-'))
    try:
        folder = pathlib.Path(args.folder).resolve() if args.folder else work / 'fetched'
        if args.fetch:
            folder.mkdir(parents=True)
            fetch_into(args.fetch, folder)
        manifest = json.loads((folder / 'release-manifest.json').read_text())
        faults = []
        if not manifest['signed'] and not args.allow_unsigned:
            faults.append('The app is not signed; it must not be published')
        if not manifest['updatesConfigured'] and not args.allow_unsigned:
            faults.append('The app has no update key; it must not be published')
        sums = dict(reversed(line.split('  ', 1)) for line in (folder / 'SHA256SUMS').read_text().splitlines())
        for name, entry in manifest['files'].items():
            actual = sha256(folder / name)
            if sums.get(name) != actual:
                faults.append(f'{name}: SHA256SUMS says {sums.get(name)}, the file is {actual}')
            if actual != entry['sha256'] or (folder / name).stat().st_size != entry['size']:
                faults.append(f'{name}: the manifest does not match the file')
        if set(sums) != set(manifest['files']):
            faults.append('SHA256SUMS and the manifest list different files')
        zip_name, dmg_name = artifact_names(manifest['version'])
        if not faults:
            opened = work / 'zip'
            run(['ditto', '-x', '-k', folder / zip_name, opened])
            if sorted(path.name for path in opened.iterdir()) != ['Pip.app']:
                faults.append('The ZIP does not hold exactly Pip.app')
            else:
                problems, _ = inspect_app(opened / 'Pip.app', manifest['version'], need_update_key=not args.allow_unsigned)
                faults.extend('ZIP: ' + problem for problem in problems)
                if tree_digest(opened / 'Pip.app') != manifest['appTree']:
                    faults.append('The ZIP\'s app is not the app the manifest describes')
            mount = mounted(folder / dmg_name)
            try:
                entries = sorted(path.name for path in mount.iterdir() if not path.name.startswith('.'))
                if entries != ['Applications', 'Pip.app']:
                    faults.append(f'The DMG holds {entries}, expected Applications and Pip.app')
                elif os.readlink(mount / 'Applications') != '/Applications':
                    faults.append('The DMG\'s Applications link does not point to /Applications')
                elif tree_digest(mount / 'Pip.app') != manifest['appTree']:
                    faults.append('The DMG\'s app is not the app the manifest describes')
            finally:
                subprocess.run(['hdiutil', 'detach', '-force', str(mount)], capture_output=True)
                shutil.rmtree(mount, ignore_errors=True)
        if not faults and manifest['signed'] and not args.allow_unsigned:
            import sign_release
            faults.extend(sign_release.inspect_folder(folder))
        if faults:
            sys.exit('Verification failed:\n- ' + '\n- '.join(faults))
        print(f'Verified Pip {manifest["version"]}: checksums, manifest, ZIP and DMG agree and the app is self-contained (signed: {manifest["signed"]}).')
    finally:
        shutil.rmtree(work, ignore_errors=True)


def cask(args):
    folder = pathlib.Path(args.folder).resolve()
    manifest = json.loads((folder / 'release-manifest.json').read_text())
    zip_name, _ = artifact_names(manifest['version'])
    template = f'''cask "{RELEASE["caskToken"]}" do
  version "{manifest["version"]}"
  sha256 "{manifest["files"][zip_name]["sha256"]}"

  url "{RELEASE["downloadBase"]}/v#{{version}}/Pip-#{{version}}-{RELEASE["architecture"]}.zip"
  name "Pip"
  desc "Local-first desktop companion for the Mac"
  homepage "https://github.com/{RELEASE["repository"]}"

  depends_on macos: ">= :sonoma"
  depends_on arch: :{RELEASE["architecture"]}

  app "Pip.app"
end
'''
    out = pathlib.Path(args.out).resolve() if args.out else folder / f'{RELEASE["caskToken"]}.rb'
    out.write_text(template)
    print('Wrote', out)


def rehearse(args):
    sys.path.insert(0, str(ROOT / 'scripts'))
    import rehearse_release
    rehearse_release.run(args, ROOT, RELEASE, artifact_names, run)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('package'); p.add_argument('--app', help='package this already-built (for example signed) app instead of building')
    p.add_argument('--rehearsal', action='store_true', help='accept a build with no update key, for local rehearsal only'); p.set_defaults(run=package)
    p = commands.add_parser('verify'); p.add_argument('folder', nargs='?'); p.add_argument('--fetch', help='download the files from this base URL into a disposable folder first')
    p.add_argument('--allow-unsigned', action='store_true', help='accept an unsigned package without an update key, for local rehearsal only'); p.set_defaults(run=verify)
    p = commands.add_parser('cask'); p.add_argument('folder'); p.add_argument('--out'); p.set_defaults(run=cask)
    p = commands.add_parser('rehearse'); p.add_argument('folder'); p.add_argument('--output', required=True, help='an existing empty folder outside the working copy for evidence')
    p.add_argument('--only', choices=['launch', 'update'], help='run just one rehearsal')
    p.add_argument('--scenario', help='with --only update, run just this scenario (good-update, up-to-date, tampered-download, wrong-key, homebrew-copy)'); p.set_defaults(run=rehearse)
    args = parser.parse_args()
    args.run(args)


if __name__ == '__main__':
    main()
