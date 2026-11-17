// reference-app/lib/text-input.js must refuse exactly the strings that
// Integrity ingestion refuses for Unicode reasons (integrity/ingest.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnsupportedCharacter, checkTextInputs } from '../reference-app/lib/text-input.js';
import { checkUnicode } from '../integrity/ingest.js';

const integrityCode = (s) => { try { checkUnicode(s); return null; } catch (e) { return e.code; } };

test('agrees with integrity checkUnicode on every BMP code unit and every plane-end code point', () => {
  const samples = [];
  for (let u = 0; u <= 0xffff; u++) samples.push(`a${String.fromCharCode(u)}b`);
  for (let plane = 1; plane <= 16; plane++) {
    for (const low of [0x0000, 0xfffd, 0xfffe, 0xffff]) samples.push(String.fromCodePoint(plane * 0x10000 + low));
  }
  samples.push('😀', '\ude00\ud83d', '\ud83d', 'x\udc00', '\ud83d😀', '');
  for (const s of samples) {
    const bad = findUnsupportedCharacter(s);
    assert.equal(bad ? bad.code : null, integrityCode(s), JSON.stringify(s));
  }
});

test('reports labelled, plain-language errors and skips clean text', () => {
  const errors = checkTextInputs([
    { label: '$.decision.summary', text: 'Price ￾' },
    { label: '$.assumptions[0]', text: 'broken \ud800 paste' },
    { label: '$.decision.context', text: 'Café 😀 ‮ fine' },
  ]);
  assert.deepEqual(errors, [
    '$.decision.summary: contains the Unicode noncharacter U+FFFE, which records may not contain. Remove it.',
    '$.assumptions[0]: contains an unpaired surrogate (U+D800), usually from a damaged paste. Retype the text.',
  ]);
});
