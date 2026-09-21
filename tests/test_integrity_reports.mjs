import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { newReport, failedCheck, verifyArtifacts } from '../integrity/verify.js';
import { generateArtifacts } from '../integrity/generate.js';
import { IntegrityError } from '../integrity/errors.js';
import { REPORT_LIMITS, addDiagnostic, reportPointer, setReportValue, serializeReport } from '../integrity/report.js';
import { fixture, receipt, bytes } from './integrity-helpers.mjs';

const cli = fileURLToPath(new URL('../integrity/cli.js', import.meta.url));
const good = fixture('profile-receipt.json');
const triplet = { recordBytes: good, ...generateArtifacts({ recordBytes: good }) };

test('diagnostic capacity is checked before constructing another pointer', () => {
  const report = newReport(); let called = 0;
  for (let i = 0; i < 10000; i++) addDiagnostic(report, () => { called++; return { code: 'OBSERVATION' }; });
  assert.equal(called, 20);
  assert.equal(report.diagnostics.length, 20);
  assert.equal(report.diagnostics_truncated, true);
  assert.equal(report.report_truncated, true);
});

test('bounded pointer stops consuming its source and reports truncation explicitly', () => {
  const path = ['a'.repeat(1000000)];
  Object.defineProperty(path, 1, { get() { throw new Error('must not consume a later segment'); } });
  assert.deepEqual(reportPointer(path), { path: '/' + 'a'.repeat(1021), path_truncated: true });
  assert.deepEqual(reportPointer(['a/b', '~', 0]), { path: '/a~1b/~0/0' });
  const emoji = reportPointer(['😀'.repeat(100000)]);
  assert.equal(emoji.path.isWellFormed(), true);
  assert.equal(emoji.path_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(emoji.path)) <= 1024);
});

test('detail bounds cover keys, strings, collection size, depth, shared nodes and bytes', () => {
  const report = newReport();
  const repeated = Array(1000).fill('\x7f'.repeat(100000));
  const deep = { a: { b: { c: { d: { e: 'hidden' } } } } };
  const detail = { ['k'.repeat(100000)]: 'omit this key', repeated, deep };
  const check = failedCheck(new IntegrityError('IO_FAILURE', 4, detail), report);
  assert.equal(check.code, 'IO_FAILURE'); assert.equal(check.exit_code, 4);
  assert.equal(check.details_truncated, true); assert.equal(report.report_truncated, true);
  assert.ok(!Object.keys(check).some(k => k.length > 1024));
  assert.ok(check.repeated.length <= 128);
  assert.ok(Buffer.byteLength(serializeReport({ ...newReport(), checks: { operation: check } }).text) < 40 * 1024);
  const depth = failedCheck(new IntegrityError('X', 1, deep));
  assert.equal(depth.details_truncated, true);
  assert.equal(depth.a.b.c.d, null);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(failedCheck(new IntegrityError('X', 1, cyclic)).details_truncated, true);
});

test('aggregate optional report material has a budget independent of the input limit', () => {
  const report = newReport();
  for (let i = 0; i < 30; i++) setReportValue(report, 'value' + i, Array(128).fill('x'.repeat(100000)));
  assert.equal(report.report_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(report)) < 70 * 1024);
  assert.ok(Buffer.byteLength(serializeReport(report).text) <= REPORT_LIMITS.maxReportBytes);
});

test('many schema failures do not accumulate their error strings in the report', () => {
  const r = receipt();
  r.evidence = Array(4000).fill({ source: '', metric: '', value: 1, unit: '', freshness_days: -1 });
  const recordBytes = bytes(r);
  assert.ok(recordBytes.length < 1048576);
  const g = generateArtifacts({ recordBytes });
  assert.equal(g.report.checks.record_input.status, 'pass');
  assert.equal(g.report.checks.record_schema.code, 'RECORD_SCHEMA');
  assert.equal(g.report.exit_code, 1);
  assert.ok(Buffer.byteLength(serializeReport(g.report).text) < 2048);
  assert.equal(g.integrityBytes, undefined);
});

test('wide nested detail bounds traversal as well as serialized bytes', () => {
  let visited = 0;
  const leaf = {};
  for (let i = 0; i < 128; i++) Object.defineProperty(leaf, 'k' + i, { enumerable: true, get() { visited++; return ''; } });
  const error = new IntegrityError('X', 1, { repeated: Array(128).fill(leaf) });
  const detail = failedCheck(error);
  assert.ok(visited < 1024);
  assert.equal(detail.details_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(detail)) < 32768);
});

test('all 66 independent related failures survive, including the final unresolved cause', () => {
  const invalid = receipt(); delete invalid.decision.owner;
  const invalidBytes = Buffer.from(JSON.stringify(invalid).replace('"review_after_days":1', '"review_after_days":1.0000000000000001'));
  const unresolved = receipt(); unresolved.evidence_as_of = '2016-12-31T23:59:60Z';
  const unresolvedBytes = Buffer.from(JSON.stringify(unresolved).replace('"review_after_days":1', '"review_after_days":1.0000000000000001'));
  const related = [...Array(31).fill(invalidBytes), unresolvedBytes];
  for (const relatedRecords of [related, [...related].reverse()]) {
    const r = verifyArtifacts({ ...triplet, receiptBytes: invalidBytes, relatedRecords });
    assert.equal(r.exit_code, 2);
    assert.equal(r.checks.relationships.causes.length, 66);
    assert.equal(r.checks.relationships.causes.filter(c => c.code === 'RAW_INTEGER_REQUIRED').length, 33);
    assert.equal(r.checks.relationships.causes.filter(c => c.code === 'RECORD_SCHEMA').length, 32);
    assert.equal(r.checks.relationships.causes.filter(c => c.code === 'SCHEMA_FORMAT_UNRESOLVED').length, 1);
    assert.equal(r.checks.relationships.details_truncated, undefined);
    assert.ok(Buffer.byteLength(serializeReport(r).text) < 32 * 1024);
  }
});

test('long record IDs are bounded for display but full IDs still control binding', () => {
  const r = receipt(); r.receipt_id = 'bl_2026-09-19_' + 'a'.repeat(300000);
  const recordBytes = bytes(r), g = generateArtifacts({ recordBytes });
  assert.equal(g.report.exit_code, 0);
  assert.equal(g.report.record_id_truncated, true);
  assert.ok(g.report.record_id.length < 1024);
  const v = verifyArtifacts({ recordBytes, ...g });
  assert.equal(v.exit_code, 0); assert.equal(v.checks.record_binding.status, 'pass');
  assert.ok(Buffer.byteLength(serializeReport(v).text) < 4096);
  const m = JSON.parse(g.integrityBytes); m.record_id = m.record_id.slice(0, -1) + 'b';
  const swapped = verifyArtifacts({ recordBytes, ...g, integrityBytes: bytes(m) });
  assert.equal(swapped.exit_code, 1);
  assert.equal(swapped.checks.record_binding.code, 'RECORD_BINDING_MISMATCH');
});

test('ordinary report and artifact bytes keep their behavior', () => {
  const v = verifyArtifacts(triplet);
  assert.equal(v.exit_code, 0); assert.equal(v.report_truncated, undefined);
  assert.deepEqual(triplet.markdownBytes, fixture('profile-receipt.md'));
  assert.equal(serializeReport(v).text, JSON.stringify(v) + '\n');
});

for (const exit of [0, 1, 2, 3, 4]) test('serializer refuses excess material before full allocation; precedence ' + exit, () => {
  const r = newReport(); r.exit_code = exit; r.extra = '\x7f'.repeat(1000000);
  const output = serializeReport(r), parsed = JSON.parse(output.text);
  assert.equal(output.exitCode, Math.max(2, exit));
  assert.equal(parsed.exit_code, output.exitCode);
  assert.equal(parsed.code, 'REPORT_RESOURCE_LIMIT');
  assert.equal(parsed.result, 'incomplete');
  assert.ok(Buffer.byteLength(output.text) < 1024);
  assert.deepEqual(parsed.assurance, r.assurance);
});

test('terminal escaping and exact aggregate wire boundary include the final LF', () => {
  const plain = { exit_code: 0, value: '' };
  const overhead = Buffer.byteLength(JSON.stringify(plain) + '\n');
  plain.value = 'a'.repeat(REPORT_LIMITS.maxReportBytes - overhead);
  const exact = serializeReport(plain);
  assert.equal(Buffer.byteLength(exact.text), REPORT_LIMITS.maxReportBytes);
  plain.value += 'a'; assert.equal(JSON.parse(serializeReport(plain).text).code, 'REPORT_RESOURCE_LIMIT');
  const control = { exit_code: 0, value: '\x1b\x7f\u202e😀\\"\n' };
  const encoded = serializeReport(control).text;
  assert.deepEqual(JSON.parse(encoded), control);
  assert.equal(encoded.includes('\x7f'), false); assert.equal(encoded.includes('\u202e'), false);
});

test('static nested/repeated hostile diagnostics are bounded through CLI verify', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'basisline-report-class-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const record = join(dir, 'record'), metadata = join(dir, 'metadata');
  const raw = Buffer.from('{'+JSON.stringify('~/'.repeat(250000))+':{"nested":['+Array(20000).fill('1.0000000000000001').join(',')+']}}');
  assert.ok(raw.length < 1048576);
  await writeFile(record, raw); await writeFile(metadata, '{}');
  const child = spawnSync(process.execPath, ['--max-old-space-size=512', cli, 'verify', '--record', record, '--integrity', metadata, '--record-only'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: REPORT_LIMITS.maxReportBytes,
  });
  assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.stderr, '');
  assert.equal(child.status, 1); assert.equal(child.stdout.split('\n').length, 2);
  const r = JSON.parse(child.stdout);
  assert.equal(r.diagnostics.length, 20); assert.equal(r.diagnostics_truncated, true);
  assert.equal(r.checks.record_schema.code, 'RECORD_SCHEMA');
  assert.equal(r.checks.metadata_schema.code, 'METADATA_SCHEMA');
  assert.ok(Buffer.byteLength(child.stdout) < 32 * 1024);
});
