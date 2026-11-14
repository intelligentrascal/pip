#!/usr/bin/env python3
"""Build a local candidate from an exact committed allowlist. Never publish or copy history.

This is a bounded disclosure check, not a secret detector or legal clearance.
See docs/PUBLICATION.md for the separate human review gates.
"""
import argparse
import hashlib
import json
import pathlib
import posixpath
import re
import subprocess
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = 'publication-files.json'
FORBIDDEN = re.compile(r'(^|/)(?:\.git|node_modules|build|dist|\.build|\.swiftpm|__pycache__|profiles?|backups?|captures?|logs?|test-results|playwright-report)(/|$)|(?:^|/)\.env(?:\.|$)|(?:^|/)[^/]+\.app(?:/|$)|(?:credentials|custom-auth|provider-auth)[^/]*\.json$|\.(?:sqlite\w*|db|log|zip|tar|gz|app|dmg|pem|key|p12|mobileprovision|pyc)$', re.I)
# Do not print matching content: reports can themselves become disclosure surfaces.
PATTERNS = {
    'personal-absolute-path': re.compile(rb'/(?:Users|home)/[^/\s<>]+/'),
    'credential-shaped': re.compile(rb'(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)'),
    'private-evidence-reference': re.compile(rb'crewmates/[a-z0-9]+/(?:evidence|sessions)|file:' + rb'//', re.I),
    'email-shaped': re.compile(rb'[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)(?![A-Za-z0-9.-])|users\.noreply\.github\.com(?![A-Za-z0-9.-]))[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
}

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], stderr=subprocess.PIPE)

def within(child, parent):
    """Conservatively compare resolved paths on macOS-style case-insensitive volumes."""
    child_parts = tuple(unicodedata.normalize('NFC', part).casefold() for part in child.resolve().parts)
    parent_parts = tuple(unicodedata.normalize('NFC', part).casefold() for part in parent.resolve().parts)
    return child_parts[:len(parent_parts)] == parent_parts


def candidate(revision):
    head = git('rev-parse', '--verify', revision + '^{commit}').decode().strip()
    entries, names = {}, set()
    for record in git('ls-tree', '-rz', '--full-tree', head).split(b'\0'):
        if not record:
            continue
        metadata, raw_path = record.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        path = raw_path.decode('utf-8')
        normalized = unicodedata.normalize('NFC', path).casefold()
        if normalized in names:
            raise ValueError('Tracked paths collide on a case-insensitive filesystem')
        names.add(normalized)
        if mode not in ('100644', '100755') or kind != 'blob':
            raise ValueError('Non-regular tracked entry rejected: ' + path)
        entries[path] = (mode, oid)
    if MANIFEST not in entries:
        raise ValueError('Committed publication-files.json is required')
    manifest = json.loads(git('cat-file', 'blob', entries[MANIFEST][1]))
    if not {'schema', 'include', 'exclude'} <= set(manifest) or set(manifest) - {'schema', 'include', 'exclude', 'reviewedFindings'} or manifest['schema'] != 1:
        raise ValueError('Unsupported publication manifest')
    included, excluded = manifest['include'], manifest['exclude']
    if not isinstance(included, list) or not isinstance(excluded, dict):
        raise ValueError('Manifest must use an exact include list and reasoned exclusions')
    if len(set(included)) != len(included) or set(included) & set(excluded):
        raise ValueError('Duplicate or overlapping manifest entries')
    # Excluded local records are absent in the future fresh public project.
    if set(entries) - set(included) - set(excluded) or set(included) - set(entries):
        raise ValueError('Unexpected or missing tracked paths; review and update the exact manifest')
    if not all(isinstance(reason, str) and reason.strip() for reason in excluded.values()):
        raise ValueError('Every exclusion needs a reason')
    reviewed = manifest.get('reviewedFindings', [])
    if not isinstance(reviewed, list):
        raise ValueError('Reviewed findings must be a list')
    exceptions = {}
    for item in reviewed:
        if not isinstance(item, dict) or set(item) != {'path', 'check', 'sha256', 'reason'} or not all(isinstance(value, str) and value for value in item.values()):
            raise ValueError('A reviewed finding needs path, check, exact byte hash and reason')
        key = (item['path'], item['check'], item['sha256'])
        if item['path'] not in included or item['check'] not in PATTERNS or key in exceptions:
            raise ValueError('Invalid or duplicate reviewed finding')
        exceptions[key] = item['reason']
    used = set()
    files, findings = {}, []
    for path in sorted(included):
        parts = pathlib.PurePosixPath(path).parts
        if not parts or any(part in ('.', '..') for part in parts) or path.startswith('/') or '\\' in path or FORBIDDEN.search(path):
            raise ValueError('Forbidden export path: ' + path)
        mode, oid = entries[path]
        data = git('cat-file', 'blob', oid)
        for name, pattern in PATTERNS.items():
            if pattern.search(data):
                key = (path, name, hashlib.sha256(data).hexdigest())
                if key in exceptions:
                    used.add(key)
                else:
                    findings.append({'path': path, 'check': name})
        files[path] = (mode, data)
    if used != set(exceptions):
        raise ValueError('Stale reviewed finding; re-review changed bytes or remove the exception')
    if findings:
        raise ValueError('Disclosure scan requires review: ' + json.dumps(findings))
    # Candidate documentation must not point at excluded local records or absent media.
    for path, (_, data) in files.items():
        if not path.endswith('.md'):
            continue
        text = data.decode('utf-8')
        links = re.findall(r'\]\(([^)\s]+)(?:\s+[^)]*)?\)', text)
        links += re.findall(r'(?:src|href)=[\"\']([^\"\']+)[\"\']', text)
        for link in links:
            if link.startswith('#') or re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', link):
                continue
            target = posixpath.normpath(posixpath.join(posixpath.dirname(path), link.split('#')[0]))
            if target not in files:
                raise ValueError('Candidate documentation link is missing or excluded: ' + path + ' -> ' + link)
    digest = hashlib.sha256()
    records = []
    for path, (mode, data) in files.items():
        checksum = hashlib.sha256(data).hexdigest()
        digest.update((path + '\0' + mode + '\0' + checksum + '\n').encode())
        records.append({'path': path, 'mode': mode, 'bytes': len(data), 'sha256': checksum})
    return files, {'sourceCommit': head, 'treeDigest': digest.hexdigest(), 'files': records,
                   'excluded': excluded, 'reviewedFindings': reviewed, 'publicationApproved': False,
                   'limits': ['Pattern scans are bounded, not proof of absence.',
                              'No history, refs, identities or media-rights approval is created.',
                              'Final settled source, media review and exact-content approval remain mandatory.']}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', default='HEAD', help='Committed local source revision')
    parser.add_argument('--output', type=pathlib.Path, help='New directory outside this working copy; no .git is created')
    parser.add_argument('--report', required=True, type=pathlib.Path, help='Private JSON report outside this working copy')
    args = parser.parse_args()
    try:
        report = args.report.absolute()
        if within(report, ROOT) or report.exists() or report.is_symlink():
            raise ValueError('Report must be a new external file')
        output = args.output.absolute() if args.output else None
        if output and (output.exists() or output.is_symlink() or within(output, ROOT)):
            raise ValueError('Output must be a new external directory')
        if output and within(report, output):
            raise ValueError('Private report must remain outside the candidate directory')
        files, result = candidate(args.revision)
        # Validate everything before creating the candidate directory.
        if output:
            output.mkdir(parents=True, exist_ok=False)
            for path, (mode, data) in files.items():
                destination = output / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
                destination.chmod(0o755 if mode == '100755' else 0o644)
        report.parent.mkdir(parents=True, exist_ok=True)
        with report.open('x') as stream:
            json.dump(result, stream, indent=2)
            stream.write('\n')
        print(f'Local candidate checked: {len(files)} files. Publication is NOT approved.')
    except (ValueError, subprocess.CalledProcessError, OSError) as error:
        print('Export refused: ' + str(error), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
