import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCaptured } from '../integrity/files.js';

async function setup(t, content) {
  const dir = await mkdtemp(join(tmpdir(), 'basisline-read-budget-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'input'); await writeFile(path, content);
  const h = await open(path, 'r'); const proto = Object.getPrototypeOf(h); await h.close();
  return { path, proto };
}

for (const step of [1, 7, 65535]) test('short reads fill bounded chunks: step ' + step, async t => {
  const content = Buffer.alloc(step === 65535 ? 131073 : 4096, 65);
  const { path, proto } = await setup(t, content);
  const read = proto.read, backing = new Set(); let calls = 0;
  t.mock.method(proto, 'read', function(buffer, offset, length, position) {
    calls++; backing.add(buffer.buffer);
    return read.call(this, buffer, offset, Math.min(step, length), position);
  });
  const captured = await readCaptured(path, 1048576);
  assert.deepEqual(captured, content);
  assert.ok(calls > 2);
  assert.ok([...backing].reduce((n, b) => n + b.byteLength, 0) <= content.length + 65536);
  assert.ok(backing.size <= Math.ceil((content.length + 1) / 65536));
});

test('a near-limit static file allocates by bytes read, with one overflow-probe byte', async t => {
  const content = Buffer.alloc(1048576, 90), { path, proto } = await setup(t, content);
  const read = proto.read, backing = new Set(); let requested = 0;
  t.mock.method(proto, 'read', function(buffer, offset, length, position) {
    requested += length; backing.add(buffer.buffer);
    return read.call(this, buffer, offset, length, position);
  });
  assert.deepEqual(await readCaptured(path, content.length), content);
  assert.equal(requested, content.length + 1);
  assert.equal([...backing].reduce((n, b) => n + b.byteLength, 0), content.length + 1);
});

for (const declared of [0n, 16777216n]) test('stable but inconsistent metadata refuses partial capture: size ' + declared, async t => {
  const { path, proto } = await setup(t, Buffer.alloc(4096, 65));
  const stat = proto.stat, read = proto.read, backing = new Set();
  t.mock.method(proto, 'stat', async function(...args) { const s = await stat.apply(this, args); s.size = declared; return s; });
  t.mock.method(proto, 'read', function(buffer, ...args) { backing.add(buffer.buffer); return read.call(this, buffer, ...args); });
  await assert.rejects(readCaptured(path, 67108864), e => e.code === 'FILE_CHANGED_DURING_READ' && e.exitCode === 4);
  assert.equal([...backing].reduce((n, b) => n + b.byteLength, 0), 65536);
});

test('premature EOF is refused even if descriptor metadata is unchanged', async t => {
  const { path, proto } = await setup(t, Buffer.alloc(4096, 65));
  const read = proto.read; let calls = 0;
  t.mock.method(proto, 'read', function(buffer, offset, length, position) {
    if (++calls > 1) return Promise.resolve({ bytesRead: 0, buffer });
    return read.call(this, buffer, offset, Math.min(length, 100), position);
  });
  await assert.rejects(readCaptured(path, 1048576), /FILE_CHANGED_DURING_READ/);
});

test('growth is refused promptly without accumulating chunks until EOF', async t => {
  const { path, proto } = await setup(t, 'x'); const read = proto.read;
  let calls = 0;
  t.mock.method(proto, 'read', async function(buffer, offset, length, position) {
    const r = await read.call(this, buffer, offset, Math.min(length, 1), position);
    if (++calls === 1) await writeFile(path, 'xx');
    return r;
  });
  await assert.rejects(readCaptured(path, 1048576), /FILE_CHANGED_DURING_READ/);
  assert.equal(calls, 2);
});

test('metadata underreporting cannot hide data beyond the configured payload limit', async t => {
  const { path, proto } = await setup(t, Buffer.alloc(4097, 65));
  const stat = proto.stat, read = proto.read; let actual = 0;
  t.mock.method(proto, 'stat', async function(...args) { const s = await stat.apply(this, args); s.size = 4096n; return s; });
  t.mock.method(proto, 'read', async function(...args) { const r = await read.apply(this, args); actual += r.bytesRead; return r; });
  await assert.rejects(readCaptured(path, 4096), /RESOURCE_BYTES/);
  assert.equal(actual, 4097);
});

test('oversized sparse files are refused before any read or payload allocation', async t => {
  const { path, proto } = await setup(t, '');
  const h = await open(path, 'r+'); await h.truncate(67108865); await h.close();
  t.mock.method(proto, 'read', () => { throw new Error('must not read oversized file'); });
  await assert.rejects(readCaptured(path, 1048576), /RESOURCE_BYTES/);
});
