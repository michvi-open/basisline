import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateArtifacts } from '../integrity/generate.js';
import { ingest, pointer } from '../integrity/ingest.js';
import { fixture } from './integrity-helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../integrity/cli.js', import.meta.url));
const assurance = {
  historical_existence: 'not_established', authorship: 'not_established',
  currentness: 'not_established', history_completeness: 'not_established',
};
function containedReport(args) {
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', ...args], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.split('\n').length, 2);
  const report = JSON.parse(child.stdout);
  assert.equal(child.status, report.exit_code);
  assert.deepEqual(report.assurance, assurance);
  return report;
}

for (const [label, key, count] of [
  ['original', 'k'.repeat(32768), 4096],
  ['escaped ancestor', '~/'.repeat(16384), 4096],
  ['larger within default limits', 'k'.repeat(400000), 40000],
]) test('RC-01 bounded-heap ingestion: ' + label, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'basisline-resource-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const record = join(dir, 'record.json'), metadata = join(dir, 'metadata.json');
  const raw = Buffer.from(JSON.stringify({ [key]: Array(count).fill(0) }));
  assert.ok(raw.length < 1048576);
  assert.ok(2 * count + 5 < 100000);
  await writeFile(record, raw);
  await writeFile(metadata, '{}');
  const report = containedReport([cli, 'verify', '--record', record,
    '--integrity', metadata, '--record-only']);
  assert.equal(report.exit_code, 1);
  assert.equal(report.result, 'checks_failed');
  assert.equal(report.checks.record_input.status, 'pass');
  assert.equal(report.checks.record_schema.code, 'RECORD_SCHEMA');
  assert.equal(report.checks.canonicalization.status, 'skipped');
});

test('RC-01 primary generation and related inputs remain contained', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'basisline-resource-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const good = fixture('profile-receipt.json'), hostile = JSON.parse(good);
  hostile['k'.repeat(32768)] = Array(4096).fill(0);
  const paths = Object.fromEntries(['good', 'bad', 'metadata', 'markdown', 'newmeta', 'newmd']
    .map(name => [name, join(dir, name)]));
  const artifacts = generateArtifacts({ recordBytes: good });
  assert.equal(artifacts.report.exit_code, 0);
  await writeFile(paths.good, good);
  await writeFile(paths.bad, JSON.stringify(hostile));
  await writeFile(paths.metadata, artifacts.integrityBytes);
  await writeFile(paths.markdown, artifacts.markdownBytes);
  const before = await readFile(paths.bad);
  const generation = containedReport([cli, 'generate', '--record', paths.bad,
    '--integrity', paths.newmeta, '--markdown', paths.newmd]);
  assert.equal(generation.exit_code, 1);
  assert.equal(generation.checks.record_schema.code, 'RECORD_SCHEMA');
  await assert.rejects(stat(paths.newmeta), { code: 'ENOENT' });
  await assert.rejects(stat(paths.newmd), { code: 'ENOENT' });
  assert.deepEqual(await readFile(paths.bad), before);
  for (const related of [[paths.bad, paths.good], [paths.good, paths.bad]]) {
    const report = containedReport([cli, 'verify', '--record', paths.good,
      '--integrity', paths.metadata, '--markdown', paths.markdown,
      ...related.flatMap(path => ['--related-record', path])]);
    assert.equal(report.exit_code, 1);
    assert.equal(report.checks.fingerprint_match.status, 'pass');
    assert.deepEqual(report.checks.relationships.causes, [{
      input: 'related-record', index: related.indexOf(paths.bad), check: 'record_schema',
      status: 'fail', code: 'RECORD_SCHEMA', exit_code: 1,
    }]);
  }
});

test('RC-01 raw number locations and escaped diagnostic paths retain their meaning', () => {
  const parsed = ingest(Buffer.from('{"a/b":{"~":[1.0000000000000001,0]}}'));
  assert.deepEqual([...parsed.numbers].map(([path, info]) => [pointer(path), info.raw]), [
    ['/a~1b/~0/0', '1.0000000000000001'], ['/a~1b/~0/1', '0'],
  ]);
  const raw = Buffer.from('{"a/b":{"~":[' + Array(25).fill('1.0000000000000001').join(',') + ']}}');
  const result = generateArtifacts({ recordBytes: raw });
  assert.equal(result.report.exit_code, 1);
  assert.equal(result.report.diagnostics.length, 20);
  assert.deepEqual(result.report.diagnostics[0], { code: 'DECIMAL_ROUNDING', path: '/a~1b/~0/0' });
  assert.deepEqual(result.report.diagnostics[19], { code: 'DECIMAL_ROUNDING', path: '/a~1b/~0/19' });
});

test('RC-01 numeric tracking and capped diagnostics stay bounded for rounded descendants', () => {
  const source = `
    import {generateArtifacts} from './integrity/generate.js';
    const key = '~/'.repeat(16384);
    const raw = Buffer.from('{'+JSON.stringify(key)+':['+Array(4096).fill('1.0000000000000001').join(',')+']}');
    const result = generateArtifacts({recordBytes:raw});
    console.log(JSON.stringify(result.report));
    process.exitCode = result.report.exit_code;
  `;
  const report = containedReport(['--input-type=module', '-e', source]);
  assert.equal(report.exit_code, 1);
  assert.equal(report.diagnostics.length, 20);
  assert.equal(report.diagnostics[19].path, '/' + '~0~1'.repeat(255) + '~');
  assert.equal(report.diagnostics[19].path_truncated, true);
  assert.equal(report.diagnostics_truncated, true);
});

test('diagnostic report stays bounded for a static maximum-size hostile key', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'basisline-report-bound-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const record = join(dir, 'record.json'), sidecar = join(dir, 'sidecar.json'), markdown = join(dir, 'record.md');
  const raw = Buffer.from('{'+JSON.stringify('\u007f'.repeat(1000000))+':['+Array(20).fill('1.0000000000000001').join(',')+']}');
  assert.equal(raw.length, 1000386);
  assert.ok(raw.length < 1048576);
  await writeFile(record, raw);
  const child = spawnSync(process.execPath, ['--max-old-space-size=512', cli, 'generate', '--record', record, '--integrity', sidecar, '--markdown', markdown], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 1);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.split('\n').length, 2);
  assert.ok(Buffer.byteLength(child.stdout) < 32 * 1024);
  const report = JSON.parse(child.stdout);
  assert.equal(report.checks.record_schema.code, 'RECORD_SCHEMA');
  assert.equal(report.diagnostics.length, 20);
  assert.ok(report.diagnostics.every(d => d.path === '/' + '\u007f'.repeat(170) && d.path_truncated === true));
  assert.equal(report.diagnostics_truncated, true);
  assert.equal(report.report_truncated, true);
  await assert.rejects(stat(sidecar), { code: 'ENOENT' });
  await assert.rejects(stat(markdown), { code: 'ENOENT' });
  const again = spawnSync(process.execPath, ['--max-old-space-size=512', cli, 'generate', '--record', record, '--integrity', sidecar, '--markdown', markdown], {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024,
  });
  assert.equal(again.status, 1);
  assert.equal(again.stdout, child.stdout);
});
