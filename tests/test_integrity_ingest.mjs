import test from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../integrity/ingest.js';
import { inspectNumber } from '../integrity/numbers.js';
import { generateArtifacts } from '../integrity/generate.js';
import { receipt, bytes } from './integrity-helpers.mjs';

const raw = s => Buffer.from(s);
const reject = (s, code) => assert.throws(() => ingest(raw(s)), e => e.code === code);
for (const s of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}',
  '{"x":[{"a":1,"\\u0061":2}]}', '{"😀":1,"\\ud83d\\ude00":2}',
  '{"__proto__":1,"__proto__":2}']) {
  test('duplicate decoded name: ' + s, () => reject(s, 'DUPLICATE_MEMBER'));
}
for (const s of ['', '{}{}', '{} junk', '{"a":1,}', '[1,]', '{"a":/*x*/1}', '//x\n{}',
  '{"a":01}', '{"a":+1}', '{"a":.5}', '{"a":1.}', '{"a":1e}', '{"a":NaN}', '{"a":Infinity}',
  '{"a":"\\x20"}', '{"a":"\n"}', '{"a":1', '[}', '{}\u00a0']) {
  test('malformed JSON: ' + JSON.stringify(s), () => assert.throws(() => ingest(raw(s))));
}
for (const hex of ['c0af','e080af','eda080','f4908080','e282','80','f5808080']) {
  test('fatal UTF8 ' + hex, () => assert.throws(() => ingest(Buffer.from(hex, 'hex')), e => e.code === 'UTF8_INVALID'));
}
test('JSON BOM rejected', () => assert.throws(() => ingest(Buffer.concat([Buffer.from('efbbbf','hex'),raw('{}')])), e => e.code === 'JSON_BOM'));
for (const s of ['"\\ud800"','"\\udfff"','"\\udfff\\ud800"','{"\\ud800":1}']) {
  test('lone surrogate ' + s, () => reject(s, 'UNICODE_SURROGATE'));
}
for (const cp of [0xfdd0,0xfdef,0xfffe,0xffff,0x1fffe,0x10ffff]) {
  test('noncharacter ' + cp.toString(16), () => reject(JSON.stringify(String.fromCodePoint(cp)), 'UNICODE_NONCHARACTER'));
}
test('valid Unicode is preserved, including controls, confusables, replacement character', () => {
  const values = ['é','e\u0301','a','а','😀','�','\u0000','\u202e','\ufeff'];
  assert.deepEqual(ingest(bytes(values)).value, values);
});
test('owned null-prototype members and repeated names in separate objects', () => {
  const { value } = ingest(raw('{"__proto__":{"x":1},"constructor":2,"toString":3,"a":{"x":2}}'));
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.getPrototypeOf(value.__proto__), null);
  assert.equal(value.constructor, 2);
  assert.equal({}.x, undefined);
  assert.ok(Object.isFrozen(value));
});
test('byte API rejects shared memory and strings', () => {
  assert.throws(() => ingest('{}'), /EXPECTED_UNSHARED_BYTES/);
  assert.throws(() => ingest(new Uint8Array(new SharedArrayBuffer(2))), /EXPECTED_UNSHARED_BYTES/);
});
test('byte snapshot does not alias the caller', () => {
  const b = raw('{"x":1}'), p = ingest(b); b.fill(0);
  assert.equal(p.value.x, 1); assert.equal(Buffer.from(p.captured).toString(), '{"x":1}');
});
for (const [input, options, code] of [
  ['"abcdef"', {maxBytes:4}, 'RESOURCE_BYTES'],
  ['[1,2,3]', {maxNodes:3}, 'RESOURCE_NODES'],
  ['[[[[]]]]', {}, 'RESOURCE_DEPTH'],
  ['{"x":'.repeat(10000) + '0' + '}'.repeat(10000), {}, 'RESOURCE_DEPTH'],
]) test(code + ' bounded refusal', () => assert.throws(() => ingest(raw(input), options), e => e.code === code));
test('huge string/array/object and exponent stay bounded', () => {
  for (const s of ['"'+'x'.repeat(1048576)+'"', '['+'0,'.repeat(600000)+'0]', '{"a":0,'+'"b":0,'.repeat(200000)+'"c":0}']) {
    assert.throws(() => ingest(raw(s)), /RESOURCE_BYTES/);
  }
  assert.throws(() => inspectNumber('1e'+'9'.repeat(100000)), /NUMBER_OVERFLOW/);
  assert.throws(() => inspectNumber('1e-'+'9'.repeat(100000)), /NUMBER_UNDERFLOW/);
  assert.equal(inspectNumber('0e'+'9'.repeat(100000)).value, 0);
});

const accepted = [
  ['71.2','71.2'], ['0.4','0.4'], ['9007199254740991','9007199254740991'],
  ['9007199254740992','9007199254740992'], ['9007199254740994','9007199254740994'],
  ['1e20','100000000000000000000'], ['1e21','1e+21'], ['1e22','1e+22'],
  ['-0','0'], ['-0.000e999','0'], ['5e-324','5e-324'], ['-5e-324','-5e-324'],
  ['333333333.33333329','333333333.3333333'], ['1.0000000000000001','1'],
  ['9007199254740993.1','9007199254740994'], ['90071992547409920e-1','9007199254740992'],
  ['0.000000000000000000000001e46','1e+22'],
];
for (const [token, expected] of accepted) test('numeric acceptance and closure: ' + token, () => {
  const n = inspectNumber(token);
  assert.equal(n.spelling, expected);
  assert.equal(inspectNumber(expected).spelling, expected);
});
for (const token of ['9007199254740993','9007199254740993.0','90071992547409930e-1','9.007199254740993e15',
  '1e23','295147905179352825856','295147905179352830000','-295147905179352825856',
  '2951479051793528258560e-1','295147905179352825856.1','1.7976931348623157e308',
  '-1.7976931348623157e308','1e400','-1e400','1e-400','-1e-400']) {
  test('numeric refusal: ' + token, () => assert.throws(() => inspectNumber(token)));
}
test('schema integer requires raw mathematical integer, not rounded Number', () => {
  for (const path of ['review', 'freshness']) {
    const r = receipt();
    const source = bytes(r).toString().replace(path === 'review' ? '"review_after_days":1' : '"freshness_days":1',
      path === 'review' ? '"review_after_days":1.0000000000000001' : '"freshness_days":0.99999999999999999');
    const result = generateArtifacts({recordBytes:raw(source)});
    assert.equal(result.report.checks.numeric_profile.code, 'RAW_INTEGER_REQUIRED');
    assert.equal(result.report.exit_code, 1); assert.equal(result.integrityBytes, undefined);
  }
});
test('canonical expansion must fit same ingestion budget', () => {
  const r = receipt(); const source = bytes(r).toString().replace('71.2','1e20');
  const a = generateArtifacts({recordBytes:raw(source),limits:{maxBytes:Buffer.byteLength(source)}});
  assert.equal(a.report.checks.canonicalization.code, 'RESOURCE_CANONICAL_BYTES');
});
