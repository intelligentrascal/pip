#!/usr/bin/env python3
"""ELF-71 intent: the release is signed inside-out with hardened runtime and the reviewed entitlements, and an Apple submission is
journaled the moment Apple answers, never repeated for the same content and never treated as accepted unless Apple says so.
The app is a real folder tree with real Mach-O headers and the real sign_release.py; only the Apple tools (codesign, xcrun) are
stand-in programs that record their arguments, because signing and notarization need the maintainer's certificate and account."""
import importlib.util, json, os, pathlib, shutil, stat, sys, tempfile, unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / 'scripts'))
spec = importlib.util.spec_from_file_location('sign_release', SOURCE / 'scripts/sign_release.py')
sign_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sign_release)

STUB = '''#!/bin/sh
{ basename "$0"; for argument in "$@"; do printf '\t%s' "$argument"; done; echo; } | tr -d '\n' >> "$STUB_LOG"; echo >> "$STUB_LOG"
case "$(basename "$0")" in
  xcrun)
    case "$2" in
      submit) echo '{"id": "11111111-aaaa", "message": "Successfully uploaded file"}' ;;
      wait) exit 0 ;;
      info) echo "{\\"id\\": \\"11111111-aaaa\\", \\"status\\": \\"$STUB_STATUS\\"}" ;;
      log) echo '{"issues": [{"message": "The binary is not signed"}]}' ;;
    esac ;;
esac
exit 0
'''


class SigningFlow(unittest.TestCase):
    def setUp(self):
        self.folder = pathlib.Path(tempfile.mkdtemp(prefix='pip-sign-test-', dir=os.environ.get('PIP_TEST_ROOT')))
        self.addCleanup(shutil.rmtree, self.folder, True)
        bin_folder = self.folder / 'bin'
        bin_folder.mkdir()
        for name in ('codesign', 'xcrun'):
            (bin_folder / name).write_text(STUB)
            (bin_folder / name).chmod(0o755)
        self.log = self.folder / 'calls.log'
        self.log.write_text('')
        previous = {key: os.environ.get(key) for key in ('PATH', 'STUB_LOG', 'STUB_STATUS')}
        os.environ.update({'PATH': f'{bin_folder}:{previous["PATH"]}', 'STUB_LOG': str(self.log), 'STUB_STATUS': 'Accepted'})
        self.addCleanup(lambda: [os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v) for k, v in previous.items()])
        # The shape of the packaged app: Mach-O files at the depths the real bundle has them, plus data that must not be signed on its own.
        self.app = self.folder / 'Pip.app'
        for relative in ('Contents/MacOS/Pip', 'Contents/MacOS/node', 'Contents/Resources/node_modules/@steipete/peekaboo/peekaboo',
                         'Contents/Resources/node_modules/@steipete/peekaboo/libswiftCompatibilitySpan.dylib'):
            path = self.app / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'\xcf\xfa\xed\xfe' + b'\0' * 28)
        (self.app / 'Contents/Resources/web').mkdir()
        (self.app / 'Contents/Resources/web/index.html').write_text('<html></html>')
        self.journal = self.folder / 'journal.json'
        self.submission = self.folder / 'Pip.zip'
        self.submission.write_bytes(b'archive')

    def calls(self):
        return [line.split('\t') for line in self.log.read_text().splitlines() if line]

    def test_nested_code_is_signed_before_the_app_with_hardened_runtime_and_reviewed_entitlements(self):
        sign_release.sign_app('Developer ID Application: Example (TEAM123456)', self.app)
        signs = [call for call in self.calls() if '--sign' in call]
        self.assertEqual(len(signs), 4, signs)
        targets = [call[-1] for call in signs]
        self.assertEqual(targets[-1], str(self.app))
        self.assertNotIn(str(self.app / 'Contents/MacOS/Pip'), targets, 'the app executable is signed with the bundle, not on its own')
        self.assertTrue(all('runtime' in call and '--timestamp' in call for call in signs))
        node = next(call for call in signs if call[-1].endswith('/Contents/MacOS/node'))
        self.assertTrue(node[node.index('--entitlements') + 1].endswith('node.entitlements.plist'))
        self.assertTrue(signs[-1][signs[-1].index('--entitlements') + 1].endswith('pip.entitlements.plist'))
        helpers = [call for call in signs if 'peekaboo' in call[-1]]
        self.assertTrue(helpers and all('--entitlements' not in call for call in helpers))
        self.assertTrue(any('--verify' in call and '--deep' in call and '--strict' in call for call in self.calls()), 'the finished signature is verified')

    def test_a_submission_is_journaled_once_and_not_repeated_for_the_same_content(self):
        sign_release.notarize('pip-notary', self.submission, 'app', 'digest-1', self.journal, self.folder)
        self.assertEqual(json.loads(self.journal.read_text())['app']['status'], 'Accepted')
        sign_release.notarize('pip-notary', self.submission, 'app', 'digest-1', self.journal, self.folder)
        self.assertEqual(len([call for call in self.calls() if 'submit' in call]), 1)

    def test_a_journaled_submission_of_different_content_is_refused_not_replaced(self):
        sign_release.notarize('pip-notary', self.submission, 'app', 'digest-1', self.journal, self.folder)
        with self.assertRaises(SystemExit) as raised:
            sign_release.notarize('pip-notary', self.submission, 'app', 'digest-2', self.journal, self.folder)
        self.assertIn('different bytes', str(raised.exception))
        self.assertEqual(len([call for call in self.calls() if 'submit' in call]), 1)

    def test_anything_but_accepted_stops_and_keeps_apples_log(self):
        os.environ['STUB_STATUS'] = 'Invalid'
        with self.assertRaises(SystemExit) as raised:
            sign_release.notarize('pip-notary', self.submission, 'app', 'digest-1', self.journal, self.folder)
        self.assertIn('Invalid', str(raised.exception))
        self.assertEqual(json.loads(self.journal.read_text())['app']['status'], 'Invalid')
        self.assertTrue(list(self.folder.glob('app-*.log.json')))

    def test_an_app_that_is_already_signed_is_never_signed_again(self):
        (self.app / 'Contents/_CodeSignature').mkdir()
        arguments = type('Arguments', (), {'app': str(self.app), 'identity': 'x', 'notary_profile': 'p', 'journal': str(self.folder / 'j'), 'resume': False})
        with self.assertRaises(SystemExit) as raised:
            sign_release.sign(arguments)
        self.assertIn('already signed', str(raised.exception))
        self.assertEqual(self.calls(), [])


if __name__ == '__main__':
    unittest.main()
