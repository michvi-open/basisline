// Reference-app numeric input: no silent rounding or alteration.
// Checks reference-app/lib/number-input.js against the normative Integrity
// implementation (integrity/numbers.js) and end to end through generation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeNumberInput, checkNumberInputs } from '../reference-app/lib/number-input.js';
import { parseFormNumber, parseEvidenceRows, buildReceiptObject } from '../reference-app/lib/form-mapping.js';
import { inspectNumber } from '../integrity/numbers.js';
import { generateArtifacts } from '../integrity/generate.js';

const accepted = [
  ['0', 0, false], ['-0', -0, false], ['1.25', 1.25, false], ['.5', 0.5, false], ['-.5', -0.5, false],
  ['1e2', 100, false], ['2.5E-2', 0.025, false], ['007', 7, false], ['1.50', 1.5, false], ['71.2', 71.2, false],
  ['9007199254740991', 9007199254740991, false], ['9007199254740992', 9007199254740992, false],
  ['9007199254740994', 9007199254740994, false], ['1e20', 1e20, false], ['1e21', 1e21, false], ['1e22', 1e22, false],
  ['5e-324', 5e-324, false], ['2251799813685248.5', 2251799813685248.5, false], ['4503599627370496.5', 4503599627370496, true],
  ['0.30000000000000001', 0.3, true], ['1.0000000000000001', 1, true], ['12345678901234.567', 12345678901234.566, true],
  ['0e999999999', 0, false],
];
const rejected = [
  ['9007199254740993', 'INTEGER_NOT_EXACT'], ['1e23', 'INTEGER_NOT_EXACT'], ['295147905179352825856', 'INTEGER_NOT_EXACT'],
  ['295147905179352830000', 'INTEGER_NOT_EXACT'],
  // Integral M whose binary64 value is not exactly M (spec: M = X = K is required).
  ['1.7976931348623157e308', 'INTEGER_NOT_EXACT'], ['1.5e300', 'INTEGER_NOT_EXACT'], ['123456789012345678901234567890.5', 'CANONICAL_INTEGER_CHANGED'],
  ['1e400', 'OVERFLOW'], ['-1e400', 'OVERFLOW'], ['1e-400', 'UNDERFLOW'], ['2e-324', 'UNDERFLOW'],
  ['', 'SYNTAX'], [' 1', 'SYNTAX'], ['1 ', 'SYNTAX'], ['12abc', 'SYNTAX'], ['1e', 'SYNTAX'], ['1.', 'SYNTAX'], ['.', 'SYNTAX'],
  ['-', 'SYNTAX'], ['+1', 'SYNTAX'], ['0x10', 'SYNTAX'], ['Infinity', 'SYNTAX'], ['NaN', 'SYNTAX'], ['1,000', 'SYNTAX'],
  ['١٢', 'SYNTAX'],
];

for (const [text, value, rounded] of accepted) {
  test(`accepted ${JSON.stringify(text)}${rounded ? ' with rounding warning' : ''}`, () => {
    const r = analyzeNumberInput(text);
    assert.equal(r.ok, true, r.reason);
    assert.ok(Object.is(r.value, value), `${r.value} !== ${value}`);
    assert.equal(r.rounded, rounded);
    assert.equal(r.stored, JSON.stringify(value));
  });
}
for (const [text, code] of rejected) {
  test(`rejected ${JSON.stringify(text)} (${code})`, () => {
    const r = analyzeNumberInput(text);
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
    assert.ok(Number.isNaN(parseFormNumber(text)), 'parseFormNumber never returns an altered value');
  });
}
test('whole-number fields refuse fractional input even when it rounds to an integer', () => {
  for (const text of ['1.5', '1.0000000000000001', '0.99999999999999999', '1e-1']) {
    assert.equal(analyzeNumberInput(text, { integer: true }).code, 'WHOLE_NUMBER_REQUIRED', text);
  }
  for (const text of ['1', '1.0', '1e2', '100.00']) assert.equal(analyzeNumberInput(text, { integer: true }).ok, true, text);
});

// --- Differential agreement with the normative implementation -------------
function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function corpus() {
  const rand = mulberry32(20261116);
  const int = (n) => Math.floor(rand() * n);
  const digits = (n) => Array.from({ length: n }, () => int(10)).join('');
  const tokens = new Set(accepted.concat(rejected).map(([t]) => t).filter((t) => /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t)));
  for (const [, spelling] of JSON.parse(readFileSync(new URL('fixtures/jcs-vectors.json', import.meta.url), 'utf8'))) {
    if (spelling !== null) tokens.add(spelling);
  }
  for (let p = -330; p <= 310; p += 7) for (const m of ['1', '9', '4.9406564584124654', '2.2250738585072014']) tokens.add(`${m}e${p}`);
  for (let i = 0; i < 20000; i++) {
    const head = int(5) === 0 ? '0' : String(1 + int(9)) + digits(int(24));
    const frac = int(2) ? '' : '.' + digits(1 + int(22));
    const exp = int(3) ? '' : (int(2) ? 'e' : 'E') + ['', '+', '-'][int(3)] + String(int(int(4) ? 30 : 400));
    tokens.add((int(4) ? '' : '-') + head + frac + exp);
  }
  return [...tokens];
}
test('agrees with integrity/numbers.js inspectNumber on every JSON-grammar token in the corpus', (t) => {
  const tokens = corpus();
  assert.ok(tokens.length > 15000, `corpus size ${tokens.length}`);
  let acceptedCount = 0, roundedCount = 0;
  for (const token of tokens) {
    let info = null;
    try { info = inspectNumber(token); } catch { /* refused by the profile */ }
    const app = analyzeNumberInput(token);
    assert.equal(app.ok, info !== null, `acceptance differs for ${token}: ${app.code}`);
    if (!info) continue;
    acceptedCount++;
    if (app.rounded) roundedCount++;
    assert.ok(Object.is(app.value, info.value), token);
    assert.equal(app.stored, info.spelling, token);
    assert.equal(app.rounded, info.rounded, `rounding flag differs for ${token}`);
    assert.equal(analyzeNumberInput(token, { integer: true }).ok, info.integer, `integer field differs for ${token}`);
  }
  t.diagnostic(`corpus ${tokens.length}: ${acceptedCount} accepted, ${roundedCount} rounded, ${tokens.length - acceptedCount} refused`);
  assert.ok(acceptedCount > 1000 && roundedCount > 100 && tokens.length - acceptedCount > 100, 'corpus exercises all outcomes');
});

// --- End to end: app output is always accepted by Integrity ---------------
const fields = {
  receipt_id: 'bl_2026-09-19_num', summary: 'S', context: 'C', owner: 'Owner role', date: '2026-09-19',
  confidence: 'medium', evidence_as_of: '2026-09-19T10:00:00Z', assumptions: ['A'],
};
const recordBytes = (record) => Buffer.from(JSON.stringify(record, null, 2));
function receiptFor(valueText, reviewText = '30') {
  const evidence = parseEvidenceRows([{ source: 'Finance', metric: 'm', value: valueText, unit: 'INR', freshness_days: '1' }]);
  return buildReceiptObject({ ...fields, evidence, review_after_days: parseFormNumber(reviewText) });
}
for (const [text, , rounded] of accepted) {
  test(`app-accepted ${JSON.stringify(text)} generates Integrity companions${rounded ? ' with DECIMAL_ROUNDING' : ''}`, () => {
    const { report } = generateArtifacts({ recordBytes: recordBytes(receiptFor(text)) });
    assert.equal(report.exit_code, 0, JSON.stringify(report.checks));
    // The exported spelling is already canonical, so re-ingestion never reports rounding.
    assert.ok(!report.diagnostics.some((d) => d.code === 'DECIMAL_ROUNDING'));
  });
}
test('inputs the previous app accepted silently are now blocked, and Integrity refuses their altered output', () => {
  for (const [text, field] of [['9007199254740993', 'value'], ['1e23', 'value'], ['1.0000000000000001', 'review']]) {
    const previous = Number(text); // the previous parseFormNumber result
    const record = field === 'value'
      ? buildReceiptObject({ ...fields, evidence: [{ source: 'F', metric: 'm', value: previous, unit: 'INR', freshness_days: 1 }], review_after_days: 30 })
      : buildReceiptObject({ ...fields, evidence: [{ source: 'F', metric: 'm', value: 1, unit: 'INR', freshness_days: 1 }], review_after_days: previous });
    const { report } = generateArtifacts({ recordBytes: Buffer.from(JSON.stringify(record).replace(String(previous), text)) });
    assert.notEqual(report.exit_code, 0, `Integrity accepted typed ${text}`);
    const check = checkNumberInputs([{ label: 'X', text, integer: field === 'review' }]);
    assert.equal(check.errors.length, 1, text);
  }
});

test('checkNumberInputs skips blanks, labels errors, and shows the stored value in warnings', () => {
  const { errors, warnings } = checkNumberInputs([
    { label: 'Evidence 1 value', text: '' }, { label: 'Evidence 1 value', text: '   ' },
    { label: 'Evidence 2 value', text: '9007199254740993' },
    { label: 'Evidence 3 value', text: '0.30000000000000001' },
    { label: 'Review after (days)', text: '1.5', integer: true },
    { label: 'Evidence 4 value', text: '1e2' },
  ]);
  assert.deepEqual(errors, [
    'Evidence 2 value: "9007199254740993" is a whole number that cannot be stored exactly (it would become 9007199254740992).',
    'Review after (days): "1.5" must be a whole number.',
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Evidence 3 value: you entered "0\.30000000000000001"; the record will store 0\.3\. /);
});
