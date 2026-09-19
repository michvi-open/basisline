/**
 * A minimal JSON Schema (draft-07 subset) validator.
 *
 * Supports only the keywords Basisline's schemas actually use: type,
 * properties, required, additionalProperties, items, enum, const,
 * pattern, format (date / date-time), minLength, minItems, minimum.
 *
 * This exists so the reference app validates against the real schema
 * files at runtime instead of re-encoding the rules by hand — the
 * schema stays the single source of truth, this is just an engine
 * for reading it. No DOM dependency, so it runs in the browser or
 * under Node for testing.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/i;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function validDate(value) {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function validDateTime(value) {
  const match = DATE_TIME_RE.exec(value);
  if (!match) return false;
  const [, date, hour, minute, second, , offsetHour, offsetMinute] = match;
  // Check syntax/components only. :60 is permitted notation; this check does not
  // establish that a leap second occurred. See the README compatibility notes.
  return validDate(date) && Number(hour) < 24 && Number(minute) < 60 && Number(second) <= 60 &&
    (offsetHour === undefined || (Number(offsetHour) < 24 && Number(offsetMinute) < 60));
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "object" | "string" | "number" | "boolean" | "undefined"
}

function checkType(value, expected, path, errors) {
  const actual = typeOf(value);
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const ok = expectedList.some((t) => {
    if (t === "integer") return Number.isFinite(value) && Number.isInteger(value);
    if (t === "number") return actual === "number" && Number.isFinite(value);
    return actual === t;
  });
  if (!ok) {
    const received = actual === "number" && !Number.isFinite(value) ? `${value} (non-finite number)` : actual;
    errors.push(`${path}: expected type ${expectedList.join(" or ")}, got ${received}`);
  }
  return ok;
}

function validateNode(value, schema, path, errors) {
  if (schema.const !== undefined) {
    if (value !== schema.const) {
      errors.push(`${path}: expected constant "${schema.const}", got "${value}"`);
    }
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: value "${value}" is not one of [${schema.enum.join(", ")}]`);
    }
  }

  if (schema.type !== undefined) {
    const okType = checkType(value, schema.type, path, errors);
    if (!okType) return; // no point checking further constraints on wrong type
  }

  const actual = typeOf(value);

  if (actual === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: "${value}" does not match pattern ${schema.pattern}`);
    }
    if (schema.format === "date" && !validDate(value)) {
      errors.push(`${path}: "${value}" is not a valid date (YYYY-MM-DD)`);
    }
    if (schema.format === "date-time" && !validDateTime(value)) {
      errors.push(`${path}: "${value}" has invalid date-time syntax or calendar/time components`);
    }
  }

  if (actual === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
  }

  if (actual === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: array has ${value.length} item(s), needs at least ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validateNode(item, schema.items, `${path}[${i}]`, errors));
    }
  }

  if (actual === "object") {
    const props = schema.properties || {};

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!hasOwn(value, key)) {
          errors.push(`${path}: missing required field "${key}"`);
        }
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!hasOwn(props, key)) {
          errors.push(`${path}: unexpected field "${key}" not allowed by schema`);
        }
      }
    }

    for (const key of Object.keys(props)) {
      if (hasOwn(value, key)) {
        validateNode(value[key], props[key], `${path}.${key}`, errors);
      }
    }
  }
}

/**
 * @param {object} schema - a parsed JSON Schema (draft-07 subset, see above)
 * @param {object} data - the record to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validate(schema, data) {
  const errors = [];
  validateNode(data, schema, "$", errors);
  return { valid: errors.length === 0, errors };
}
