import canonicalize from 'canonicalize';
import { IntegrityError } from './errors.js';

const NUMBER = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;

// Normalized exact decimal coefficient and scale. Exponents outside this bound
// cannot be cancelled by the token's own digits. For nonzero inputs they must
// overflow/underflow; never expand them into a BigInt or a power of ten.
function decimal(token) {
  const match = NUMBER.exec(token);
  if (!match || match[0].length !== token.length) throw new IntegrityError('JSON_NUMBER_SYNTAX');
  const fraction = match[3] || '';
  let digits = (match[2] + fraction).replace(/^0+/, '');
  if (!digits) return { sign: '', digits: '0', scale: 0, integer: true };
  const exponent = match[4] || '0';
  const bound = token.length + 1000;
  const magnitude = exponent.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
  let scale = magnitude.length > String(bound).length ? bound : Math.min(Number(magnitude), bound);
  if (exponent[0] === '-') scale = -scale;
  scale -= fraction.length;
  // A suffix regex can retry a long interior zero run quadratically.
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end--;
  scale += digits.length - end;
  digits = digits.slice(0, end);
  return { sign: match[1], digits, scale, integer: scale >= 0 };
}

const equal = (a, b) => a.sign === b.sign && a.digits === b.digits && a.scale === b.scale;

// Called on raw scanner tokens BEFORE the visitor converts any numbers.
export function inspectNumber(token) {
  const m = decimal(token);
  const value = Number(token);
  if (!Number.isFinite(value)) throw new IntegrityError('NUMBER_OVERFLOW');
  if (m.digits !== '0' && value === 0) throw new IntegrityError('NUMBER_UNDERFLOW');
  const spelling = canonicalize(value);
  const k = decimal(spelling);
  // BigInt(number), not BigInt(number.toString()), is the exact binary64 integer.
  const x = Number.isInteger(value) ? decimal(BigInt(value).toString()) : null;
  if (m.integer && (!x || !equal(m, x) || !equal(m, k))) {
    throw new IntegrityError('INTEGER_VALUE_CHANGED');
  }
  if (k.integer && (!x || !equal(k, x))) throw new IntegrityError('CANONICAL_INTEGER_CHANGED');
  return Object.freeze({ raw: token, value, integer: m.integer, spelling, rounded: !equal(m, k) });
}
