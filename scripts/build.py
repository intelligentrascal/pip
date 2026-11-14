#!/usr/bin/env python3
"""Build an unsigned, uninstalled local app. Never signs or changes Gatekeeper."""
import pathlib, plistlib, shutil, subprocess, re, json, hashlib, struct
import xml.etree.ElementTree as ET
ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'build/Pip.app/Contents'
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
outline = registration['outline']; assert artwork(outline['file']) == outline['size']
contour = image(rig, outline); contour.set('data-outline','')
hero = node('g', {'data-part':'hero', 'data-pivot':f'{canvas[0]/2} {canvas[1]/2}'}, rig)
for name in registration['paintOrder']:
    part = registration['parts'][name]
    if name in optional and not (art / part['file']).exists(): continue
    assert artwork(part['file']) == part['size']; available.add(name)
    # Separate render wrappers preserve global paint order while inheriting the
    # same logical parent transform. In particular the lantern stays in front of
    # the coat, rather than being buried in a physically contiguous arm group.
    parent = hero
    if part['parent'] != 'root':
        group = registration['groups'][part['parent']]
        parent = node('g', {'data-group':part['parent'], 'data-pivot':' '.join(map(str,group['pivot']))}, hero)
    element = node('g', {'data-part':name, 'data-pivot':' '.join(map(str,part['pivot']))}, parent)
    if name in optional: element.set('opacity','0')
    image(element, part)
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
link = resources / 'node_modules'
if not link.exists():
    link.symlink_to(ROOT / 'node_modules', target_is_directory=True)
node = shutil.which('node')
assert node, 'Node is required'
(resources / 'node-path.txt').write_text(node + '\n')
claude = shutil.which('claude')
(resources / 'claude-path.txt').write_text((claude or '') + '\n')
info = {'CFBundleName': 'Pip', 'CFBundleDisplayName': 'Pip', 'CFBundleIdentifier': 'local.pip.assistant', 'CFBundleExecutable': 'Pip', 'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '0.1.0', 'LSUIElement': True, 'NSHighResolutionCapable': True, 'LSMinimumSystemVersion': '14.0', 'NSMicrophoneUsageDescription': 'Pip uses the microphone only for explicit on-device dictation. Review the transcript before Ask.', 'NSSpeechRecognitionUsageDescription': 'Pip transcribes explicit dictation on this Mac only, without a cloud speech fallback.'}
with (APP / 'Info.plist').open('wb') as file:
    plistlib.dump(info, file)
# Backend ports compile into the bundle but are not constructed or exposed by the
# existing UI. No EventKit/notification access or permission entrypoint is added.
native_sources = [str(file) for file in sorted((ROOT / 'native').glob('*.swift'))]
subprocess.run(['swiftc', *native_sources, '-o', str(APP / 'MacOS/Pip'), '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Carbon', '-framework', 'EventKit', '-framework', 'UserNotifications', '-framework', 'AVFoundation', '-framework', 'Speech'], check=True, timeout=180)
print('Built unsigned local app:', APP.parent)
