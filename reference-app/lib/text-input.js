/**
 * Text form input checks for the reference app.
 *
 * Integrity v0.1 refuses records containing unpaired UTF-16 surrogates or
 * Unicode noncharacters (spec/integrity-v0.1.md, "Processing boundary",
 * step 4; integrity/ingest.js checkUnicode). Text pasted into a form can carry
 * either. This module applies the same rule to typed text so the app reports
 * it instead of exporting a record the Integrity CLI would refuse.
 *
 * Browser-native and dependency-free. tests/test_text_input.mjs checks it
 * against integrity/ingest.js.
 */

/** @returns {null | {code: string, codePoint: number}} the first offending character */
export function findUnsupportedCharacter(text) {
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = s.codePointAt(i);
        if ((cp & 0xfffe) === 0xfffe) return { code: "UNICODE_NONCHARACTER", codePoint: cp };
        i++;
        continue;
      }
    }
    if (unit >= 0xd800 && unit <= 0xdfff) return { code: "UNICODE_SURROGATE", codePoint: unit };
    if ((unit >= 0xfdd0 && unit <= 0xfdef) || (unit & 0xfffe) === 0xfffe) return { code: "UNICODE_NONCHARACTER", codePoint: unit };
  }
  return null;
}

const hex = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

/**
 * @param {Array<{label: string, text: string}>} inputs
 * @returns {string[]} one error per input that contains an unsupported character
 */
export function checkTextInputs(inputs) {
  const errors = [];
  for (const { label, text } of inputs) {
    const bad = findUnsupportedCharacter(text);
    if (!bad) continue;
    errors.push(bad.code === "UNICODE_SURROGATE"
      ? `${label}: contains an unpaired surrogate (${hex(bad.codePoint)}), usually from a damaged paste. Retype the text.`
      : `${label}: contains the Unicode noncharacter ${hex(bad.codePoint)}, which records may not contain. Remove it.`);
  }
  return errors;
}
