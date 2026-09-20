import test from 'node:test';
import assert from 'node:assert/strict';
import canonicalize from 'canonicalize';
import { canonicalBytes, sha256 } from '../integrity/canonicalize.js';
import { ingest } from '../integrity/ingest.js';
import { inspectNumber } from '../integrity/numbers.js';
import { fixture } from './integrity-helpers.mjs';
import { DEFAULT_LIMITS } from '../integrity/errors.js';

for (const [hex, expected] of JSON.parse(fixture('jcs-vectors.json'))) {
  test('RFC8785 Appendix B ' + hex, () => {
    const number = Buffer.from(hex,'hex').readDoubleBE();
    if (expected === null) assert.throws(() => canonicalize(number));
    else assert.equal(canonicalize(number), expected);
  });
}
test('RFC8785 section 3.2.2 serialization (component, not numeric profile)', () => {
  const value = {numbers:[333333333.33333329,1E30,4.50,2e-3,1e-27],
    string:"€$\u000f\nA'B\"\\\\\"/",literals:[null,true,false]};
  assert.equal(canonicalize(value), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
});
test('RFC8785 UTF16 ordering including supplementary and numeric keys', () => {
  const source = '{"€":"Euro Sign","\\r":"Carriage Return","דּ":"Hebrew Letter Dalet With Dagesh","1":"One","😀":"Emoji: Grinning Face","\\u0080":"Control","ö":"Latin Small Letter O With Diaeresis"}';
  const expected = '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';
  assert.equal(canonicalBytes(ingest(Buffer.from(source)).value,DEFAULT_LIMITS).toString(), expected);
  assert.equal(canonicalize(JSON.parse('{"2":0,"10":0}')), '{"10":0,"2":0}');
});
test('JCS encoding and array order', () => {
  assert.equal(canonicalize({a:[3,1,2],b:'é'}), '{"a":[3,1,2],"b":"é"}');
  assert.notEqual(canonicalize({a:[3,1,2]}),canonicalize({a:[1,2,3]}));
  const b=canonicalBytes(ingest(Buffer.from('{"b":2,"a":1}')).value,DEFAULT_LIMITS);
  assert.equal(b.toString('hex'),'7b2261223a312c2262223a327d');
  assert.equal(sha256(b),'43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});
for (const [input, digest] of [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['a'.repeat(1000000),'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
]) test('SHA256 known answer length ' + input.length, () => assert.equal(sha256(Buffer.from(input)),digest));
test('binary64 boundaries: independent BigInt preservation and canonical closure', () => {
  let accepted=0, rejected=0;
  for (let i=0n;i<1024n;i++) {
    const token=(1n<<i).toString();
    const x=Number(token), c=canonicalize(x);
    const decimalInteger = c.includes('e') ? (() => {
      const [m,e]=c.split('e'); const [a,b='']=m.split('.');
      return BigInt(a+b) * 10n ** BigInt(Number(e)-b.length);
    })() : BigInt(c);
    const expected=BigInt(x)===(1n<<i) && decimalInteger===(1n<<i);
    if (expected) { accepted++; assert.equal(inspectNumber(inspectNumber(token).spelling).value,x); }
    else { rejected++; assert.throws(()=>inspectNumber(token)); }
  }
  assert.ok(accepted>0 && rejected>0);
});
