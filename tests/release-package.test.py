#!/usr/bin/env python3
"""ELF-68 direction C intent: a download is trusted only if it is the published bytes, an unsigned or key-less app is never
published, and the Homebrew cask names exactly the bytes that were packaged. Real folders and the real release.py; no network,
signing or Keychain. The full build, DMG and launch are exercised by `release.py package/verify/rehearse`, not here."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile, unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1]
RELEASE = SOURCE / 'scripts/release.py'


def release(*arguments):
    return subprocess.run([sys.executable, str(RELEASE), *arguments], capture_output=True, text=True)


class ReleaseFolder(unittest.TestCase):
    def setUp(self):
        self.folder = pathlib.Path(tempfile.mkdtemp(prefix='pip-release-test-', dir=os.environ.get('PIP_TEST_ROOT')))
        self.addCleanup(shutil.rmtree, self.folder, True)
        # A package folder as `package` writes it, with small stand-in archive bytes: verify must stop at the checksums before opening anything.
        self.files = {'Pip-0.1.0-alpha.1-arm64.zip': b'zip bytes of the published app', 'Pip-0.1.0-alpha.1-arm64.dmg': b'dmg bytes of the published app'}
        for name, data in self.files.items():
            (self.folder / name).write_bytes(data)
        self.write_manifest(signed=True, updates=True)

    def write_manifest(self, signed, updates):
        entries = {name: {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)} for name, data in self.files.items()}
        (self.folder / 'SHA256SUMS').write_text(''.join(f'{entry["sha256"]}  {name}\n' for name, entry in entries.items()))
        (self.folder / 'release-manifest.json').write_text(json.dumps({'version': '0.1.0-alpha.1', 'signed': signed, 'updatesConfigured': updates, 'files': entries, 'appTree': 'x'}))

    def test_cask_names_the_packaged_bytes_and_cannot_delete_saved_work(self):
        out = self.folder / 'pip-house-elf.rb'
        self.assertEqual(release('cask', str(self.folder), '--out', str(out)).returncode, 0)
        cask = out.read_text()
        self.assertIn(f'sha256 "{hashlib.sha256(self.files["Pip-0.1.0-alpha.1-arm64.zip"]).hexdigest()}"', cask)
        self.assertIn('version "0.1.0-alpha.1"', cask)
        self.assertIn('cask "pip-house-elf"', cask)
        self.assertIn('releases/download/v#{version}/Pip-#{version}-arm64.zip', cask)
        self.assertIn('depends_on arch: :arm64', cask)
        self.assertNotIn('zap', cask)

    def test_a_download_that_is_not_the_published_bytes_is_refused(self):
        (self.folder / 'Pip-0.1.0-alpha.1-arm64.zip').write_bytes(b'zip bytes of a different app')
        result = release('verify', str(self.folder))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Pip-0.1.0-alpha.1-arm64.zip: SHA256SUMS says', result.stderr)

    def test_an_unsigned_or_keyless_app_is_never_published(self):
        self.write_manifest(signed=False, updates=False)
        result = release('verify', str(self.folder))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not signed', result.stderr)
        self.assertIn('no update key', result.stderr)

    def test_checksums_and_manifest_must_list_the_same_files(self):
        (self.folder / 'SHA256SUMS').write_text('')
        result = release('verify', str(self.folder), '--allow-unsigned')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('list different files', result.stderr)


if __name__ == '__main__':
    unittest.main()
