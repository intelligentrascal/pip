#!/usr/bin/env python3
"""Build an unsigned, uninstalled local app. Never signs or changes Gatekeeper.

Default: the developer build in build/Pip.app, which links this working copy's node_modules and the
Node executable on this machine. `--release` builds the self-contained Apple-silicon app in
build/release/Pip.app instead (bundled Node, production dependencies only, nothing absolute);
see scripts/release.py and docs/RELEASING.md."""
import os, pathlib, plistlib, shutil, subprocess, re, json, hashlib, struct, sys, tarfile, tempfile, urllib.request
import xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
RELEASE = '--release' in sys.argv
APP = ROOT / ('build/release/Pip.app' if RELEASE else 'build/Pip.app') / 'Contents'
if RELEASE:
    shutil.rmtree(APP.parent, ignore_errors=True)
(APP / 'MacOS').mkdir(parents=True, exist_ok=True)
resources = APP / 'Resources'
resources.mkdir(parents=True, exist_ok=True)
for source, target in [('web', 'web'), ('dist', 'runtime')]:
    shutil.copytree(ROOT / source, resources / target, dirs_exist_ok=True)
# Data-only binding for the captain-selected artwork. Handoff demo code and its
# verified/listening fixtures are never copied into the app.
art = ROOT / 'assets/curious-hearth'
registration = json.loads((art / 'manifest.json').read_text())
assert registration['schema'] == 1 and registration['assetSet'] == 'pip-curious-hearth'
canvas = registration['canvas']; optional = set(registration['optionalParts'])
assert all(group['parent']=='root' for group in registration['groups'].values()), 'Review nested logical-parent changes'
available = set()
target = resources / 'web/curious-hearth'; target.mkdir(exist_ok=True)
def artwork(name):
    assert re.fullmatch(r'[a-z0-9-]+\.png', name), 'Only registered local artwork'
    file = art / name
    assert not file.is_symlink(), 'Artwork must be a regular bundled file'
    data = file.read_bytes()
    assert hashlib.sha256(data).hexdigest() == registration['fileHashes'][name], 'Review changed artwork before rebuilding'
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    shutil.copy2(file, target / name)
    return list(struct.unpack('>II', data[16:24]))
namespace = 'http://www.w3.org/2000/svg'
ET.register_namespace('', namespace)
def node(name, attributes, parent=None):
    element = ET.Element('{'+namespace+'}'+name, {key:str(value) for key,value in attributes.items()})
    if parent is not None: parent.append(element)
    return element
def image(parent, specification):
    x,y = specification['offset']; width,height = specification['size']
    assert x >= 0 and y >= 0 and x+width <= canvas[0] and y+height <= canvas[1]
    return node('image', {'href':'curious-hearth/'+specification['file'], 'x':x, 'y':y, 'width':width, 'height':height}, parent)
rig = node('svg', {'viewBox':f'0 0 {canvas[0]} {canvas[1]}', 'width':registration['targetPoints'], 'height':registration['targetPoints'], 'aria-hidden':'true', 'data-asset-set':registration['assetSet'], 'data-fallback':'curious-hearth/'+registration['fallback']})
# The eyes are whole painted eyes with no separate pupil. Each eye's opening is covered with the eye-white colour and a copy of the
# same layer, clipped to the iris circle, moves inside it. Circles are in each eye layer's own coordinates: (opening centre, radius, iris centre, radius).
EYES = {'eye-left': ((40.5, 35.5), 27.5, (34, 31), 20.5), 'eye-right': ((38.5, 35), 29.5, (33, 30), 22)}
EYE_WHITE = '#ede4bf'
defs = node('defs', {}, rig)
for name, (opening, opening_radius, iris, iris_radius) in EYES.items():
    x, y = registration['parts'][name]['offset']; side = name.split('-')[1]
    node('circle', {'cx':x+opening[0], 'cy':y+opening[1], 'r':opening_radius}, node('clipPath', {'id':'opening-'+side}, defs))
    node('circle', {'cx':x+iris[0], 'cy':y+iris[1], 'r':iris_radius}, node('clipPath', {'id':'iris-'+side}, defs))
def pivot(spec): return ' '.join(map(str, spec['pivot']))
glow_gradient = node('radialGradient', {'id':'lantern-glow'}, defs)
node('stop', {'offset':'0', 'class':'glow-core'}, glow_gradient); node('stop', {'offset':'1', 'class':'glow-edge'}, glow_gradient)
glow = node('circle', {'class':'glow', 'cx':800, 'cy':735, 'r':330, 'fill':'url(#lantern-glow)', 'data-pivot':'800 735'}, rig)
hero = node('g', {'data-part':'hero', 'data-pivot':f'{canvas[0]/2} {canvas[1]/2}'}, rig)
def layer(parent, name):
    part = registration['parts'][name]
    if name in optional and not (art / part['file']).exists(): return None
    assert artwork(part['file']) == part['size']; available.add(name)
    element = node('g', {'data-part':name, 'data-pivot':pivot(part)}, parent)
    if name in optional: element.set('class', 'optional')
    image(element, part)
    return element
def wrapper(parent, role, origin):
    return node('g', {'data-role':role, 'data-pivot':origin}, parent)
# Paint order is the manifest's. Wrappers carry the movement: the legs and the lower body stay, the upper body breathes and leans,
# the head turns, each arm, the ears, the scarf tail and the lantern move on their own pivots, and the scrolls float in front.
for name in ('trouser-left', 'trouser-right', 'boot-left', 'boot-right'): layer(hero, name)
lean = wrapper(hero, 'lean', '585 860'); breath = wrapper(lean, 'breath', '585 860')
layer(breath, 'shoulder-backing')
arm_left = wrapper(breath, 'arm-left', pivot(registration['groups']['left-arm'])); layer(arm_left, 'arm-left'); layer(wrapper(arm_left, 'hand-left', pivot(registration['parts']['hand-left'])), 'hand-left')
arm_right = wrapper(breath, 'arm-right', pivot(registration['groups']['right-arm'])); layer(arm_right, 'arm-right'); layer(arm_right, 'hand-right')
layer(breath, 'body')
head = wrapper(breath, 'head', pivot(registration['groups']['head']))
layer(wrapper(head, 'ear-left', pivot(registration['parts']['ear-left'])), 'ear-left'); layer(wrapper(head, 'ear-right', pivot(registration['parts']['ear-right'])), 'ear-right')
layer(head, 'head')
for side in ('left', 'right'):
    base = layer(head, 'eye-'+side)
    x, y = registration['parts']['eye-'+side]['offset']; opening, opening_radius, iris, iris_radius = EYES['eye-'+side]
    eye = node('g', {'data-role':'eye', 'data-side':side, 'clip-path':f'url(#opening-{side})'}, head)
    node('circle', {'cx':x+opening[0], 'cy':y+opening[1], 'r':opening_radius, 'fill':EYE_WHITE}, eye)
    # The iris copy moves from where it was painted to the opening's centre, then follows the gaze.
    looking = node('g', {'data-role':'iris', 'data-side':side, 'data-rest':f'{opening[0]-iris[0]} {opening[1]-iris[1]}'}, eye)
    iris_image = image(node('g', {'clip-path':f'url(#iris-{side})'}, looking), registration['parts']['eye-'+side])
    layer(head, 'closed-eye-'+side)
for name in ('mouth-smile', 'mouth-neutral', 'mouth-concern'): layer(head, name)
layer(breath, 'scarf-wrap'); layer(wrapper(breath, 'scarf-tail', pivot(registration['parts']['scarf-tail'])), 'scarf-tail')
lantern_arm = wrapper(breath, 'arm-right-lantern', pivot(registration['groups']['right-arm'])); layer(wrapper(lantern_arm, 'lantern', pivot(registration['parts']['lantern'])), 'lantern')
# Each scroll: gaze drift (outer), orbit about a point to Pip's left, upright again, then its own bob. Centres are in art pixels.
for index in (1, 2, 3):
    part = registration['parts'][f'charm-{index}']
    centre = f"{part['offset'][0] + part['size'][0] / 2} {part['offset'][1] + part['size'][1] / 2}"
    drift = wrapper(hero, 'scroll', centre); drift.set('data-index', str(index))
    turn = wrapper(drift, 'scroll-turn', '215 270')
    upright = wrapper(turn, 'scroll-upright', centre)
    layer(wrapper(upright, 'scroll-bob', centre), f'charm-{index}')
assert set(registration['parts'])-optional <= available
assert artwork(registration['fallback']) == canvas
shutil.copy2(art / 'manifest.json', target / 'manifest.json')
rig_markup = '<template id="pip-character-rig">'+ET.tostring(rig, encoding='unicode')+'</template>'
page = resources / 'web/index.html'
page.write_text(page.read_text().replace('<!-- pip-character-rig -->', rig_markup))
# WKWebView's local-file loader does not load this ES-module graph. Keep the
# authored modules for isolated web tests and produce a self-contained classic
# script without eval, a server, network access or a weaker content policy.
visited, bundled = set(), []
def bundle_module(name):
    file = (ROOT / 'web' / name).resolve()
    assert file.parent == (ROOT / 'web').resolve() and file.suffix == '.js', 'Only bundled local modules'
    if file in visited:
        return
    visited.add(file)
    source = file.read_text()
    imports = r'^import [\'\"](\./[^\'\"]+)[\'\"];?\s*$'
    for dependency in re.findall(imports, source, re.MULTILINE):
        bundle_module(dependency)
    source = re.sub(imports, '', source, flags=re.MULTILINE)
    source = re.sub(r'^export (?=(?:class|const|function) )', '', source, flags=re.MULTILINE)
    source = source.replace('import.meta.url', 'document.baseURI')
    bundled.append('/* ' + file.name + ' */\n(() => {\n' + source + '\n})();')
bundle_module('app.js')
(resources / 'web/app.bundle.js').write_text("'use strict';\n" + '\n'.join(bundled))
for name in ['pip-mark.png']:
    shutil.copy2(ROOT / 'assets' / name, resources / 'web' / name)
# Old stand-in sources remain in the project for fixtures, not in the app.
for name in ['pip-companion.svg','pip-companion.png']:
    (resources / 'web' / name).unlink(missing_ok=True)
# Dependencies are pinned by package-lock. No bundled credentials or configuration.
package = json.loads((ROOT / 'package.json').read_text())
info = {'CFBundleName': 'Pip', 'CFBundleDisplayName': 'Pip', 'CFBundleIdentifier': 'local.pip.assistant', 'CFBundleExecutable': 'Pip', 'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '0.1.0', 'LSUIElement': True, 'NSHighResolutionCapable': True, 'LSMinimumSystemVersion': '14.0', 'NSMicrophoneUsageDescription': 'Pip uses the microphone only for explicit on-device dictation. Review the transcript before Ask.', 'NSSpeechRecognitionUsageDescription': 'Pip transcribes explicit dictation on this Mac only, without a cloud speech fallback.'}
SWIFT_TARGET = []
if not RELEASE:
    link = resources / 'node_modules'
    if not link.exists():
        link.symlink_to(ROOT / 'node_modules', target_is_directory=True)
    node = shutil.which('node')
    assert node, 'Node is required'
    (resources / 'node-path.txt').write_text(node + '\n')
else:
    release = json.loads((ROOT / 'release/release.json').read_text())
    runtime = json.loads((ROOT / 'release/node-runtime.json').read_text())
    SWIFT_TARGET = ['-target', 'arm64-apple-macos' + release['minimumSystemVersion'], '-gnone']  # no debug info, so no build-machine path is recorded in the binary
    info.update({'CFBundleIdentifier': release['bundleIdentifier'], 'CFBundleShortVersionString': package['version'], 'CFBundleVersion': package['version'],
                 'LSMinimumSystemVersion': release['minimumSystemVersion'], 'LSApplicationCategoryType': 'public.app-category.productivity',
                 'NSHumanReadableCopyright': release['copyright'], 'CFBundleIconFile': 'Pip',
                 'PipUpdateChannel': release['channel'], 'PipUpdateFeedURL': release['updateFeedURL']})
    key_file = ROOT / 'release/update-public-key.txt'
    # Without a provisioned public key the app builds with updates switched off; it never trusts an unsigned feed.
    if key_file.exists(): info['PipUpdatePublicKey'] = key_file.read_text().strip()
    cache = pathlib.Path(os.environ.get('PIP_RELEASE_CACHE') or tempfile.gettempdir()) / 'pip-release-cache'
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / pathlib.Path(runtime['url']).name
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != runtime['sha256']:
        archive.unlink(missing_ok=True)
        with urllib.request.urlopen(runtime['url'], timeout=120) as response: archive.write_bytes(response.read())
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == runtime['sha256'], 'The pinned Node runtime does not match release/node-runtime.json'
    work = pathlib.Path(tempfile.mkdtemp(prefix='pip-release-'))
    with tarfile.open(archive) as tar:
        tar.extractall(work / 'node', filter='data')
    node_root = next((work / 'node').iterdir())
    shutil.copy2(node_root / 'bin/node', APP / 'MacOS/node')
    licenses = resources / 'licenses'; (licenses / 'node').mkdir(parents=True)
    shutil.copy2(node_root / 'LICENSE', licenses / 'node/LICENSE')
    # Production dependencies only, from the lockfile, with no install scripts.
    stage = work / 'stage'; stage.mkdir()
    for name in ('package.json', 'package-lock.json'): shutil.copy2(ROOT / name, stage / name)
    subprocess.run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=stage, check=True, timeout=300)
    shutil.copytree(stage / 'node_modules', resources / 'node_modules', symlinks=True)
    for folder in list((resources / 'node_modules').rglob('.bin')): shutil.rmtree(folder, ignore_errors=True)
    assert not any(path.is_symlink() for path in APP.parent.rglob('*')), 'A release bundle carries no symbolic links'
    (resources / 'node_modules/.package-lock.json').unlink(missing_ok=True)
    # Apple silicon only: thin the universal Peekaboo helper and fail on any other Mach-O slice.
    for file in sorted((resources / 'node_modules').rglob('*')):
        if file.is_symlink() or not file.is_file(): continue
        with file.open('rb') as handle: magic = handle.read(4)
        if magic not in (b'\xca\xfe\xba\xbe', b'\xcf\xfa\xed\xfe'): continue
        archs = subprocess.run(['lipo', '-archs', str(file)], capture_output=True, text=True, check=True).stdout.split()
        if archs != ['arm64']:
            assert 'arm64' in archs, f'{file} has no Apple silicon slice'
            subprocess.run(['lipo', '-thin', 'arm64', str(file), '-output', str(file) + '.thin'], check=True)
            pathlib.Path(str(file) + '.thin').replace(file)
    # Each package keeps its licence files with the app; the notices list what ships.
    packages = [p.parent for p in (resources / 'node_modules').rglob('package.json') if p.parent.parent.name == 'node_modules' or p.parent.parent.parent.name == 'node_modules' and p.parent.parent.name.startswith('@')]
    inventory = []
    for folder in sorted(packages):
        meta = json.loads((folder / 'package.json').read_text())
        kept = []
        for notice in folder.iterdir():
            if re.match(r'(LICENSE|LICENCE|NOTICE|COPYING)', notice.name, re.I) and notice.is_file():
                destination = licenses / 'npm' / str(folder.relative_to(resources / 'node_modules')); destination.mkdir(parents=True, exist_ok=True)
                shutil.copy2(notice, destination / notice.name); kept.append(notice.name)
        inventory.append({'name': meta.get('name'), 'version': meta.get('version'), 'license': meta.get('license') or meta.get('licenses'), 'licenseFiles': sorted(kept)})
    (licenses / 'npm-inventory.json').write_text(json.dumps(inventory, indent=1) + '\n')
    for name in ('LICENSE', 'THIRD_PARTY_NOTICES.md'): shutil.copy2(ROOT / name, licenses / name)
    shutil.copy2(ROOT / 'release/icon/Pip.icns', resources / 'Pip.icns')
with (APP / 'Info.plist').open('wb') as file:
    plistlib.dump(info, file)
# Backend ports compile into the bundle but are not constructed or exposed by the
# existing UI. No EventKit/notification access or permission entrypoint is added.
native_sources = [str(file.relative_to(ROOT)) for file in sorted((ROOT / 'native').glob('*.swift'))]  # relative, so no machine path reaches the binary
subprocess.run(['swiftc', *SWIFT_TARGET, *native_sources, '-o', str(APP / 'MacOS/Pip'), '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Carbon', '-framework', 'EventKit', '-framework', 'UserNotifications', '-framework', 'AVFoundation', '-framework', 'Speech', '-framework', 'ApplicationServices'], check=True, timeout=180, cwd=ROOT)
if RELEASE: shutil.rmtree(work, ignore_errors=True)  # the unpacked Node and the staged dependencies
print('Built unsigned ' + ('release' if RELEASE else 'local') + ' app:', APP.parent)
