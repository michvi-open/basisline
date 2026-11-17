/**
 * Numeric form input analysis for the reference app.
 *
 * The app must never silently round or alter a user-entered number. This
 * module applies the Basisline Integrity v0.1 numeric acceptance profile
 * (spec/integrity-v0.1.md, "Numeric acceptance profile") to the text the user
 * typed, BEFORE it is converted to a JavaScript number:
 *
 *   - unsupported values are rejected with a reason (overflow, underflow to
 *     zero, integers that binary64 cannot hold exactly, fractions in
 *     whole-number fields);
 *   - decimals that the JSON/RFC 8785 binary64 model rounds are accepted with
 *     a warning that shows the value the record will actually store.
 *
 * Value-preserving respellings (1e2 -> 100, 1.50 -> 1.5, 007 -> 7) are not
 * warnings: the stored number is mathematically identical.
 *
 * Browser-native and dependency-free. tests/test_number_input.mjs checks
 * that it agrees with integrity/numbers.js on a large corpus.
 */

// HTML number-input grammar: decimal and exponent notation, optional leading
// zeros and a bare leading fraction (".5"). No hex, Infinity, NaN, or blanks.
const TOKEN = /^(-?)(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Exact decimal value as normalized { sign, digits, scale, integer }. */
function decimal(text) {
  const match = TOKEN.exec(text);
  if (!match || (match[2] === "" && match[3] === undefined)) return null;
  const fraction = match[3] || "";
  let digits = (match[2] + fraction).replace(/^0+/, "");
  if (!digits) return { sign: "", digits: "0", scale: 0, integer: true };
  const exponent = match[4] || "0";
  // As in integrity/numbers.js: exponents beyond this bound cannot be cancelled
  // by the token's own digits, so they never need exact expansion.
  const bound = text.length + 1000;
  const magnitude = exponent.replace(/^[+-]/, "").replace(/^0+/, "") || "0";
  let scale = magnitude.length > String(bound).length ? bound : Math.min(Number(magnitude), bound);
  if (exponent[0] === "-") scale = -scale;
  scale -= fraction.length;
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end--;
  scale += digits.length - end;
  digits = digits.slice(0, end);
  return { sign: match[1], digits, scale, integer: scale >= 0 };
}

const equal = (a, b) => a.sign === b.sign && a.digits === b.digits && a.scale === b.scale;

/**
 * @param {string} text - exactly what the user typed (not trimmed or coerced)
 * @param {{integer?: boolean}} [options] - integer: field is schema-integer
 * @returns {{ok: true, value: number, stored: string, rounded: boolean} |
 *           {ok: false, code: string, reason: string}}
 *   `stored` is the RFC 8785 / ECMAScript spelling written to the JSON record.
 */
export function analyzeNumberInput(text, { integer = false } = {}) {
  const typed = String(text);
  const m = decimal(typed);
  if (!m) return { ok: false, code: "SYNTAX", reason: "is not a decimal number" };
  const value = Number(typed);
  if (!Number.isFinite(value)) {
    return { ok: false, code: "OVERFLOW", reason: "is too large to store as a JSON number" };
  }
  if (m.digits !== "0" && value === 0) {
    return { ok: false, code: "UNDERFLOW", reason: "is too small to store; it would become 0" };
  }
  const stored = JSON.stringify(value); // RFC 8785 number spelling; -0 becomes 0
  const k = decimal(stored);
  // BigInt(number) is the exact binary64 integer, not a re-parse of a string.
  const x = Number.isInteger(value) ? decimal(BigInt(value).toString()) : null;
  if (m.integer && (!x || !equal(m, x) || !equal(m, k))) {
    return { ok: false, code: "INTEGER_NOT_EXACT",
      reason: `is a whole number that cannot be stored exactly (it would become ${stored})` };
  }
  if (k.integer && (!x || !equal(k, x))) {
    return { ok: false, code: "CANONICAL_INTEGER_CHANGED",
      reason: `cannot be stored without changing its value (it would become ${stored})` };
  }
  if (integer && !m.integer) {
    return { ok: false, code: "WHOLE_NUMBER_REQUIRED", reason: "must be a whole number" };
  }
  return { ok: true, value, stored, rounded: !equal(m, k) };
}

/**
 * Checks a set of labelled numeric inputs. Blank inputs are skipped so that
 * the schema validator reports them as missing/invalid fields as before.
 * @param {Array<{label: string, text: string, integer?: boolean}>} inputs
 * @returns {{errors: string[], warnings: string[]}}
 */
export function checkNumberInputs(inputs) {
  const errors = [], warnings = [];
  for (const { label, text, integer } of inputs) {
    if (String(text).trim() === "") continue;
    const result = analyzeNumberInput(text, { integer });
    const shown = JSON.stringify(String(text));
    if (!result.ok) errors.push(`${label}: ${shown} ${result.reason}.`);
    else if (result.rounded) {
      warnings.push(`${label}: you entered ${shown}; the record will store ${result.stored}. ` +
        "JSON numbers are binary64 (RFC 8785), so this decimal is rounded to the nearest representable value. " +
        "If exact decimals matter, record the value in a smaller unit (for example paise instead of rupees).");
    }
  }
  return { errors, warnings };
}
