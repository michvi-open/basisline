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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "object" | "string" | "number" | "boolean" | "undefined"
}

function checkType(value, expected, path, errors) {
  const actual = typeOf(value);
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const ok = expectedList.some((t) => {
    if (t === "integer") return actual === "number" && Number.isInteger(value);
    return actual === t;
  });
  if (!ok) {
    errors.push(`${path}: expected type ${expectedList.join(" or ")}, got ${actual}`);
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
    if (schema.format === "date" && !DATE_RE.test(value)) {
      errors.push(`${path}: "${value}" is not a valid date (YYYY-MM-DD)`);
    }
    if (schema.format === "date-time" && !DATE_TIME_RE.test(value)) {
      errors.push(`${path}: "${value}" is not a valid ISO 8601 date-time`);
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
        if (!(key in value)) {
          errors.push(`${path}: missing required field "${key}"`);
        }
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) {
          errors.push(`${path}: unexpected field "${key}" not allowed by schema`);
        }
      }
    }

    for (const key of Object.keys(props)) {
      if (key in value) {
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
