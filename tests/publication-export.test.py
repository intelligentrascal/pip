#!/usr/bin/env python3
"""ELF-28 accepted intent: fresh export must preserve history and fail closed.

Exercise the command with real project source in disposable Git repositories.
No account, provider, user data, signing or network is involved.
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1]

class PublicationExport(unittest.TestCase):
    def setUp(self):
        self.base = pathlib.Path(tempfile.mkdtemp(prefix='pip-publication-', dir=os.environ.get('PIP_TEST_ROOT')))
        self.repo = self.base / 'project'
        (self.repo / 'scripts').mkdir(parents=True)
        shutil.copyfile(SOURCE / 'scripts/publication-export.py', self.repo / 'scripts/publication-export.py')
        shutil.copyfile(SOURCE / 'package.json', self.repo / 'package.json')
        (self.repo / 'publication-files.json').write_text(json.dumps({'schema': 1, 'include': ['package.json', 'scripts/publication-export.py', 'publication-files.json'], 'exclude': {}}))
        self.git('init', '-q')
        self.git('-c', 'user.name=intelligentrascal', '-c', 'user.email=intelligentrascal@users.noreply.github.com', 'add', '.')
        self.commit()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.STDOUT)

    def commit(self):
        self.git('add', '.')
        self.git('-c', 'user.name=intelligentrascal', '-c', 'user.email=intelligentrascal@users.noreply.github.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test(publication): exercise local candidate')

    def export(self, label):
        return subprocess.run(['python3', str(self.repo / 'scripts/publication-export.py'), '--output', str(self.base / label), '--report', str(self.base / (label + '.json'))], capture_output=True, text=True)

    def test_exact_committed_bytes_without_history(self):
        before = self.git('rev-parse', 'HEAD')
        # Uncommitted edits and ignored dependencies must never be copied.
        (self.repo / 'package.json').write_text('uncommitted local edit')
        (self.repo / 'node_modules').mkdir()
        (self.repo / 'node_modules/private').write_text('not part of the source tree')
        result = self.export('candidate')
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((self.base / 'candidate.json').read_text())
        self.assertFalse(report['publicationApproved'])
        self.assertFalse((self.base / 'candidate/.git').exists())
        self.assertFalse((self.base / 'candidate/node_modules').exists())
        for item in report['files']:
            data = (self.base / 'candidate' / item['path']).read_bytes()
            self.assertEqual(data, self.git('show', 'HEAD:' + item['path']))
            self.assertEqual(hashlib.sha256(data).hexdigest(), item['sha256'])
        self.assertEqual(self.git('rev-parse', 'HEAD'), before)
        second = self.export('second')
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(report['treeDigest'], json.loads((self.base / 'second.json').read_text())['treeDigest'])
        self.assertNotEqual(self.export('candidate').returncode, 0, 'Must not overwrite reviewed output')

    def test_unexpected_tracked_path_refuses_before_output(self):
        shutil.copyfile(SOURCE / 'Package.swift', self.repo / 'Package.swift')
        self.commit()
        result = self.export('unexpected')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unexpected or missing tracked paths', result.stderr)
        self.assertFalse((self.base / 'unexpected').exists())

    def test_symlink_refuses_even_when_excluded(self):
        (self.repo / 'dependency-link').symlink_to('package.json')
        manifest = json.loads((self.repo / 'publication-files.json').read_text())
        manifest['exclude']['dependency-link'] = 'Local dependency link must never ship'
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.commit()
        result = self.export('symlink')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Non-regular tracked entry', result.stderr)
        self.assertFalse((self.base / 'symlink').exists())

    def test_private_report_cannot_enter_candidate(self):
        # A case-alias report is inside the same candidate on the build Mac's filesystem.
        for folder, report_folder in [('report-leak', 'report-leak'), ('CaseCandidate', 'casecandidate')]:
            with self.subTest(folder=folder):
                destination = self.base / folder
                report = self.base / report_folder / 'private-review.json'
                result = subprocess.run(['python3', str(self.repo / 'scripts/publication-export.py'), '--output', str(destination), '--report', str(report)], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Private report must remain outside', result.stderr)
                self.assertFalse(destination.exists())

    def test_case_aliased_working_copy_destinations_refuse(self):
        alias = self.repo.with_name(self.repo.name.upper())
        cases = [(alias / 'candidate', self.base / 'private-report.json'), (self.base / 'candidate', alias / 'private-report.json')]
        for output, report in cases:
            with self.subTest(output=output, report=report):
                result = subprocess.run(['python3', str(self.repo / 'scripts/publication-export.py'), '--output', str(output), '--report', str(report)], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())
                self.assertFalse(report.exists())

    def test_case_colliding_git_paths_refuse(self):
        # Git can hold both names even when a Mac filesystem cannot retain both byte streams.
        manifest = json.loads((self.repo / 'publication-files.json').read_text())
        manifest['include'].append('PACKAGE.json')
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.git('add', 'publication-files.json')
        oid = self.git('rev-parse', 'HEAD:package.json').decode().strip()
        self.git('update-index', '--add', '--cacheinfo', '100644,' + oid + ',PACKAGE.json')
        self.git('-c', 'user.name=intelligentrascal', '-c', 'user.email=intelligentrascal@users.noreply.github.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test(publication): reproduce case-colliding source paths')
        result = self.export('case-collision')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Tracked paths collide', result.stderr)
        self.assertFalse((self.base / 'case-collision').exists())

    def test_exclusions_work_in_source_and_fresh_public_tree(self):
        # The approved plan retains local records, but they must not make the fresh tree unusable.
        shutil.copyfile(SOURCE / 'package-lock.json', self.repo / 'local-review.json')
        manifest = json.loads((self.repo / 'publication-files.json').read_text())
        manifest['exclude']['local-review.json'] = 'Local review material, not part of the public source.'
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.commit()
        result = self.export('without-local')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.base / 'without-local/local-review.json').exists())
        self.assertTrue((self.repo / 'local-review.json').exists())
        self.repo = self.base / 'without-local'
        self.git('init', '-q')
        self.commit()
        public_result = self.export('fresh-tree')
        self.assertEqual(public_result.returncode, 0, public_result.stderr)
        reports = [json.loads((self.base / (label + '.json')).read_text()) for label in ('without-local', 'fresh-tree')]
        self.assertEqual(reports[0]['treeDigest'], reports[1]['treeDigest'])

    def test_missing_candidate_documentation_link_refuses(self):
        # Real docs index: removing its linked guides would break the public package.
        shutil.copyfile(SOURCE / 'docs/README.md', self.repo / 'docs-index.md')
        manifest = json.loads((self.repo / 'publication-files.json').read_text())
        manifest['include'].append('docs-index.md')
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.commit()
        result = self.export('broken-docs')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Candidate documentation link is missing or excluded', result.stderr)
        self.assertFalse((self.base / 'broken-docs').exists())

    def test_reviewed_fixture_exception_is_bound_to_exact_bytes(self):
        # The real browser boundary test rejects a file URL; it is not private evidence.
        source = SOURCE / 'tests/task-browser.test.ts'
        destination = self.repo / 'browser-boundary.test.ts'
        shutil.copyfile(source, destination)
        manifest = json.loads((self.repo / 'publication-files.json').read_text())
        manifest['include'].append(destination.name)
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.commit()
        refused = self.export('unreviewed')
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('Disclosure scan requires review', refused.stderr)
        manifest['reviewedFindings'] = [{'path': destination.name, 'check': 'private-evidence-reference', 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'reason': 'Real browser boundary regression rejects a local-file URL; no personal capture is referenced.'}]
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.commit()
        allowed = self.export('reviewed')
        self.assertEqual(allowed.returncode, 0, allowed.stderr)
        destination.write_bytes(destination.read_bytes() + b'\n')
        self.commit()
        stale = self.export('changed')
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn('Stale reviewed finding', stale.stderr)
        self.assertFalse((self.base / 'changed').exists())

    def test_nested_app_bundle_refuses_even_when_allowlisted(self):
        # ELF-28 explicitly excludes the machine-specific development app, not only build/.
        app = self.repo / 'Pip.app/Contents/Resources'
        app.mkdir(parents=True)
        shutil.copyfile(SOURCE / 'package.json', app / 'package.json')
        manifest = json.loads((self.repo / 'publication-files.json').read_text())
        manifest['include'].append('Pip.app/Contents/Resources/package.json')
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.git('add', '--force', 'Pip.app/Contents/Resources/package.json')
        self.commit()
        result = self.export('app-bundle')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Forbidden export path', result.stderr)
        self.assertFalse((self.base / 'app-bundle').exists())

    def test_state_path_refuses_even_when_allowlisted(self):
        # A real package file under a state-directory name must still be rejected.
        (self.repo / 'profiles').mkdir()
        shutil.copyfile(SOURCE / 'package.json', self.repo / 'profiles/package.json')
        manifest = json.loads((self.repo / 'publication-files.json').read_text())
        manifest['include'].append('profiles/package.json')
        (self.repo / 'publication-files.json').write_text(json.dumps(manifest))
        self.commit()
        result = self.export('state')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Forbidden export path', result.stderr)
        self.assertFalse((self.base / 'state').exists())

if __name__ == '__main__':
    unittest.main()
