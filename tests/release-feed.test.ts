import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { addRelease, feedBytes, newSeed, publicKeyOf, signFeed, verifyFeed, type Feed, type Release } from '../scripts/update-feed.ts';

// Intent (ELF-68, direction C): the maintainer's release tool writes the one signed feed the app trusts. It must sign exactly what it writes,
// never announce different bytes under a version it already announced, and never keep the private key in the working copy.
// Fixture: the feed and signature the app's own native checks also read (tests/fixtures/update-feed), plus a fresh key per test.
const fixtures = path.resolve(import.meta.dirname, 'fixtures/update-feed');
const release = (over: Partial<Release> = {}): Release => ({ version: '0.1.0-alpha.3', channel: 'alpha', minimumSystemVersion: '14.0', architecture: 'arm64',
  url: 'https://github.com/intelligentrascal/pip/releases/download/v0.1.0-alpha.3/Pip-0.1.0-alpha.3-arm64.zip', sha256: 'a'.repeat(64), size: 100, notes: 'Third alpha.', ...over });

test('the committed feed carries a signature its public key accepts, and one changed byte breaks it', () => {
  const bytes = readFileSync(path.join(fixtures, 'feed.json'));
  const signature = readFileSync(path.join(fixtures, 'feed.json.sig'), 'utf8');
  const key = readFileSync(path.join(fixtures, 'public-key.txt'), 'utf8');
  assert.equal(verifyFeed(bytes, signature, key), true);
  const changed = Buffer.from(bytes); changed[10] ^= 1;
  assert.equal(verifyFeed(changed, signature, key), false);
  assert.equal(verifyFeed(bytes, signature, publicKeyOf(newSeed())), false);
});

test('a feed is signed exactly as written, and the key behind a signature is the only one that verifies it', () => {
  const seed = newSeed();
  const feed = addRelease(undefined, release());
  const bytes = feedBytes(feed);
  const signature = signFeed(bytes, seed);
  assert.equal(verifyFeed(bytes, signature, publicKeyOf(seed)), true);
  assert.equal(verifyFeed(bytes, signature, publicKeyOf(newSeed())), false);
  assert.equal(verifyFeed(bytes, 'bm90IGEgc2lnbmF0dXJl', publicKeyOf(seed)), false);
  assert.equal(JSON.parse(bytes.toString()).product, 'pip');
});

test('a version is announced once: the same bytes may be re-added, different bytes under that version are refused', () => {
  const first = addRelease(undefined, release());
  assert.equal(addRelease(first, release()).releases.length, 1);
  assert.throws(() => addRelease(first, release({ sha256: 'b'.repeat(64) })), /already announced with different bytes/);
  const second = addRelease(first, release({ version: '0.1.0-alpha.4', url: 'https://github.com/intelligentrascal/pip/releases/download/v0.1.0-alpha.4/Pip.zip' }));
  assert.deepEqual(second.releases.map(item => item.version), ['0.1.0-alpha.3', '0.1.0-alpha.4']);
});

test('only real versions, known channels and https addresses are announced; a file address is for a disposable rehearsal only', () => {
  assert.throws(() => addRelease(undefined, release({ version: 'v1.0' })), /not a version/);
  assert.throws(() => addRelease(undefined, release({ channel: 'nightly' })), /channel/);
  assert.throws(() => addRelease(undefined, release({ url: 'http://example.com/Pip.zip' })), /https/);
  assert.throws(() => addRelease(undefined, release({ url: 'file:///tmp/Pip.zip' })), /https/);
  assert.equal(addRelease(undefined, release({ url: 'file:///tmp/Pip.zip' }), true).releases.length, 1);
});

test('keygen refuses a folder inside the working copy and never overwrites an existing key', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const tool = path.join(root, 'scripts/update-feed.ts');
  const run = (out: string) => spawnSync('node', ['--import', 'tsx', tool, 'keygen', '--out', out], { cwd: root, encoding: 'utf8' });
  assert.match(run(path.join(root, 'build/keys')).stderr, /outside the working copy/);
  const folder = mkdtempSync(path.join(tmpdir(), 'pip-keys-'));
  try {
    const made = run(path.join(folder, 'k'));
    assert.equal(made.status, 0);
    assert.equal(Buffer.from(made.stdout.trim(), 'base64').length, 32);
    assert.match(run(path.join(folder, 'k')).stderr, /never overwritten/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
