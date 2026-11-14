import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import dns from 'node:dns/promises';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { readPublicURL } from '../runtime/public-web.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/public-readme.json', import.meta.url), 'utf8'));

// Intent: the captain's public-reader repair request and A5/A6. The live README
// read failed because Node requested all addresses, but the callback returned one string.
// Captured public DNS + README text feed the actual reader; only network I/O is replaced.
for (const all of [true, false]) {
 test(`public reader honours Node lookup all=${all} with a validated pinned address`, async () => {
  const dnsMock = mock.method(dns, 'lookup', async () => fixture.addresses);
  const getMock = mock.method(https, 'get', ((_url: unknown, options: any, consume: any) => {
   const request = new EventEmitter() as any;
   request.destroy = (error: Error) => { request.emit('error', error); return request; };
   queueMicrotask(() => {
    options.lookup(new URL(fixture.source).hostname, { all }, (error: Error|null, addresses: unknown, family: unknown) => {
     try {
      assert.equal(error, null);
      const pinned = fixture.addresses[0];
      if (all) {
       assert.ok(Array.isArray(addresses), 'Node all-address lookup requires an array, not a single address');
       assert.deepEqual(addresses, [pinned], 'Return only the previously validated pinned address');
      } else {
       assert.equal(addresses, pinned.address);
       assert.equal(family, pinned.family);
      }
      const response = new EventEmitter() as any;
      response.statusCode = 200; response.headers = { 'content-type': fixture.contentType };
      consume(response); response.emit('data', Buffer.from(fixture.body)); response.emit('end');
     } catch (failure) { request.emit('error', failure); }
    });
   });
   return request;
  }) as any);
  syncBuiltinESMExports();
  try {
   const result = await readPublicURL(fixture.source);
   assert.equal(result.url, fixture.source);
   assert.equal(result.text, fixture.body.replace(/\s+/g, ' ').trim());
   assert.equal(dnsMock.mock.callCount(), 1, 'Resolve once, then pin the validated address');
   assert.equal(getMock.mock.callCount(), 1);
  } finally { dnsMock.mock.restore(); getMock.mock.restore(); syncBuiltinESMExports(); }
 });
}

test('a private address in DNS results prevents HTTPS dispatch entirely', async () => {
 // A deliberate rebinding variant of the captured DNS fixture, using the real loopback address.
 const dnsMock = mock.method(dns, 'lookup', async () => [...fixture.addresses, { address: '127.0.0.1', family: 4 }]);
 const getMock = mock.method(https, 'get', (() => { throw new Error('Must not connect'); }) as any);
 syncBuiltinESMExports();
 try {
  await assert.rejects(readPublicURL(fixture.source), /not a public web source/);
  assert.equal(getMock.mock.callCount(), 0, 'Reject the entire answer before any network connection');
 } finally { dnsMock.mock.restore(); getMock.mock.restore(); syncBuiltinESMExports(); }
});
