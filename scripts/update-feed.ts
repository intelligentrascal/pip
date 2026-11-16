#!/usr/bin/env -S node --import tsx
// The signed update feed: the one file the in-app updater trusts, and its detached Ed25519 signature.
//   keygen --out <folder>                              make a signing key outside the working copy; prints the public key
//   add --feed <file> --key <file> --zip <file> ...    add one release (version, channel, url, notes) and sign the whole feed
//   (add also takes --test-only yes to allow a file:// address for a disposable rehearsal)
//   verify --feed <file> --public-key <base64>         check a feed and its signature the way the app does
// The private key is read from a file you name and never printed or placed in the project.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Release = { version: string; channel: string; minimumSystemVersion: string; architecture: string; url: string; sha256: string; size: number; notes: string };
export type Feed = { schema: 1; product: 'pip'; releases: Release[] };

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const privateKeyFromSeed = (seed: Buffer) => createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
export const publicKeyOf = (seed: Buffer): string => createPublicKey(privateKeyFromSeed(seed)).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

export function newSeed(): Buffer {
  const { privateKey } = generateKeyPairSync('ed25519');
  return (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(-32);
}
/** The exact bytes that are signed: the feed as pretty JSON with a closing newline. */
export const feedBytes = (feed: Feed): Buffer => Buffer.from(JSON.stringify(feed, null, 2) + '\n');
export const signFeed = (bytes: Buffer, seed: Buffer): string => sign(null, bytes, privateKeyFromSeed(seed)).toString('base64') + '\n';
export function verifyFeed(bytes: Buffer, signature: string, publicKey: string): boolean {
  const raw = Buffer.from(publicKey.trim(), 'base64');
  if (raw.length !== 32) return false;
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  return verify(null, bytes, key, Buffer.from(signature.trim(), 'base64'));
}
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
export function addRelease(feed: Feed | undefined, release: Release, testOnly = false): Feed {
  if (!SEMVER.test(release.version)) throw new Error(`"${release.version}" is not a version like 1.2.3 or 1.2.3-alpha.1`);
  if (!['alpha', 'beta', 'stable'].includes(release.channel)) throw new Error('The channel is alpha, beta or stable');
  if (!release.url.startsWith('https://') && !(testOnly && release.url.startsWith('file://'))) throw new Error('A download address must be https');
  const current: Feed = feed ?? { schema: 1, product: 'pip', releases: [] };
  const existing = current.releases.find(item => item.version === release.version);
  if (existing && existing.sha256 !== release.sha256) throw new Error(`Version ${release.version} is already announced with different bytes; publish a new version instead`);
  return { ...current, releases: [...current.releases.filter(item => item.version !== release.version), release] };
}
export function describeZip(zip: string): { sha256: string; size: number } {
  const bytes = readFileSync(zip);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: statSync(zip).size };
}

function options(argv: string[]): Record<string, string> {
  const found: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Unexpected argument ${argv[i]}`);
    found[argv[i].slice(2)] = argv[i + 1];
  }
  return found;
}
const need = (given: Record<string, string>, name: string): string => { if (!given[name]) throw new Error(`Missing --${name}`); return given[name]; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const given = options(rest);
  if (command === 'keygen') {
    const folder = path.resolve(need(given, 'out'));
    if (folder === ROOT || folder.startsWith(ROOT + path.sep)) throw new Error('Keep the signing key outside the working copy');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, 'pip-update-signing-key.txt');
    if (existsSync(file)) throw new Error('A signing key is already there; it is never overwritten');
    const seed = newSeed();
    writeFileSync(file, seed.toString('base64') + '\n', { mode: 0o600 });
    console.log(publicKeyOf(seed));
  } else if (command === 'add') {
    const seed = Buffer.from(readFileSync(need(given, 'key'), 'utf8').trim(), 'base64');
    const feedFile = path.resolve(need(given, 'feed'));
    const previous = existsSync(feedFile) ? JSON.parse(readFileSync(feedFile, 'utf8')) as Feed : undefined;
    const { sha256, size } = describeZip(need(given, 'zip'));
    const next = addRelease(previous, { version: need(given, 'version'), channel: need(given, 'channel'), minimumSystemVersion: need(given, 'minimum-system'), architecture: need(given, 'architecture'), url: need(given, 'url'), sha256, size, notes: need(given, 'notes') }, given['test-only'] === 'yes');
    const bytes = feedBytes(next);
    writeFileSync(feedFile, bytes);
    writeFileSync(feedFile + '.sig', signFeed(bytes, seed));
    console.log(`Signed ${next.releases.length} release(s) in ${feedFile}`);
  } else if (command === 'verify') {
    const feedFile = need(given, 'feed');
    const ok = verifyFeed(readFileSync(feedFile), readFileSync(feedFile + '.sig', 'utf8'), need(given, 'public-key'));
    if (!ok) throw new Error('The feed does not match its signature');
    console.log('The feed matches its signature');
  } else throw new Error('Use keygen, add or verify');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
