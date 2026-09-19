/**
 * Tests for the reference app's pure logic (lib/validate.js,
 * lib/form-mapping.js) — no DOM required, runs under plain Node.
 *
 * Usage: node tests/test_reference_app.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import assert from "assert";

import { validate } from "../reference-app/lib/validate.js";
import { buildReceiptObject, buildOutcomeObject, linesToArray, parseFormNumber, parseEvidenceRows } from "../reference-app/lib/form-mapping.js";
import { renderReceiptMarkdown, renderOutcomeMarkdown } from "../renderer/render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const receiptSchema = JSON.parse(readFileSync(join(ROOT, "schema/decision-receipt.schema.json")));
const outcomeSchema = JSON.parse(readFileSync(join(ROOT, "schema/outcome-record.schema.json")));

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] ${name}`);
    console.log(`  ${e.message}`);
    failed++;
  }
}

// --- guard: reference-app's local schema copies must match the canonical ones ---
check("reference-app schema copies match canonical schema/", () => {
  const appReceiptSchema = readFileSync(join(ROOT, "reference-app/schema/decision-receipt.schema.json"), "utf8");
  const appOutcomeSchema = readFileSync(join(ROOT, "reference-app/schema/outcome-record.schema.json"), "utf8");
  const canonReceiptSchema = readFileSync(join(ROOT, "schema/decision-receipt.schema.json"), "utf8");
  const canonOutcomeSchema = readFileSync(join(ROOT, "schema/outcome-record.schema.json"), "utf8");
  assert.strictEqual(appReceiptSchema, canonReceiptSchema, "decision-receipt.schema.json has drifted from canonical");
  assert.strictEqual(appOutcomeSchema, canonOutcomeSchema, "outcome-record.schema.json has drifted from canonical");
});

const validReceiptFields = {
  receipt_id: "bl_2026-08-21_t3st",
  summary: "Test decision summary",
  context: "Test context",
  owner: "Test Owner",
  date: "2026-08-21",
  confidence: "medium",
  evidence: [{ source: "TestSource", metric: "test_metric", value: 100, unit: "count", freshness_days: 1 }],
  evidence_as_of: "2026-08-21T10:00:00Z",
  assumptions: linesToArray("Assumption one\nAssumption two"),
  known_conflicts: [],
  review_after_days: 30,
  supersedes: null,
  related_receipt_ids: [],
};

const validOutcomeFields = {
  outcome_id: "bo_2026-09-21_t3st",
  receipt_id: "bl_2026-08-21_t3st",
  recorded_on: "2026-09-21",
  actual_result: "Test result",
  learning: "Test learning",
};

// 1. valid receipt generates schema-valid JSON
check("valid receipt generates schema-valid JSON", () => {
  const record = buildReceiptObject(validReceiptFields);
  const result = validate(receiptSchema, record);
  assert.strictEqual(result.valid, true, `expected valid, errors: ${result.errors.join("; ")}`);
});

// 2. valid outcome generates schema-valid JSON
check("valid outcome generates schema-valid JSON", () => {
  const record = buildOutcomeObject(validOutcomeFields);
  const result = validate(outcomeSchema, record);
  assert.strictEqual(result.valid, true, `expected valid, errors: ${result.errors.join("; ")}`);
});

// 3. required field missing -> blocked
check("missing required field is blocked", () => {
  const fields = { ...validReceiptFields, owner: "" };
  const record = buildReceiptObject(fields);
  delete record.decision.owner; // simulate a genuinely absent field
  const result = validate(receiptSchema, record);
  assert.strictEqual(result.valid, false, "expected invalid due to missing owner");
  assert.ok(result.errors.some((e) => e.includes("owner")), "expected an error mentioning owner");
});

// 4. invalid confidence -> blocked
check("invalid confidence enum value is blocked", () => {
  const fields = { ...validReceiptFields, confidence: "extremely-sure" };
  const record = buildReceiptObject(fields);
  const result = validate(receiptSchema, record);
  assert.strictEqual(result.valid, false, "expected invalid due to bad confidence value");
  assert.ok(result.errors.some((e) => e.includes("confidence")), "expected an error mentioning confidence");
});

// 5. invalid date/datetime -> blocked
check("invalid date format is blocked", () => {
  const fields = { ...validReceiptFields, date: "21-08-2026" }; // wrong format
  const record = buildReceiptObject(fields);
  const result = validate(receiptSchema, record);
  assert.strictEqual(result.valid, false, "expected invalid due to bad date format");
});

check("invalid evidence_as_of datetime is blocked", () => {
  const fields = { ...validReceiptFields, evidence_as_of: "2026-08-21 10:00" }; // not ISO 8601
  const record = buildReceiptObject(fields);
  const result = validate(receiptSchema, record);
  assert.strictEqual(result.valid, false, "expected invalid due to bad datetime format");
});

// Independent expected text, rather than comparing the renderer with itself.
check("receipt Markdown matches expected field mapping", () => {
  const record = buildReceiptObject(validReceiptFields);
  assert.strictEqual(renderReceiptMarkdown(record), `## Decision: Test decision summary
**Context:** Test context
**Owner:** Test Owner · **Date:** 2026-08-21 · **Confidence:** Medium

**Evidence (as of 2026-08-21):**
- TestSource test metric: 100

**Assumptions:**
- Assumption one
- Assumption two

**Review after:** 30 days`);
});

check("outcome Markdown matches expected field mapping", () => {
  const record = buildOutcomeObject(validOutcomeFields);
  assert.strictEqual(renderOutcomeMarkdown(record), `### Outcome — recorded 2026-09-21
**Result:** Test result
**Learning:** Test learning`);
});

for (const value of [NaN, Infinity, -Infinity]) {
  for (const type of ["number", "integer"]) {
    check(`${type} rejects ${value}, including union types`, () => {
      const result = validate({ type }, value);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some((error) => error.includes("non-finite number")));
      assert.strictEqual(validate({ type: ["null", type] }, value).valid, false);
    });
  }
  check(`receipt rejects non-finite evidence and integer fields: ${value}`, () => {
    for (const field of ["value", "freshness_days"]) {
      const record = buildReceiptObject(structuredClone(validReceiptFields));
      record.evidence[0][field] = value;
      assert.strictEqual(validate(receiptSchema, record).valid, false);
    }
    const record = buildReceiptObject({ ...validReceiptFields, review_after_days: value });
    assert.strictEqual(validate(receiptSchema, record).valid, false);
  });
}

for (const testCase of JSON.parse(readFileSync(join(ROOT, "tests/date-format-cases.json")))) {
  const scope = testCase.limitation ? "JavaScript component check only" : testCase.format;
  check(`${scope}: ${JSON.stringify(testCase.value)}`, () => {
    assert.strictEqual(validate({ type: "string", format: testCase.format }, testCase.value).valid, testCase.javascript_valid ?? testCase.valid);
  });
}

for (const key of ["__proto__", "constructor", "toString"]) {
  check(`own unexpected ${key} is rejected at root and nested levels`, () => {
    const extra = JSON.parse(`{"${key}": "unexpected"}`);
    const record = buildReceiptObject(structuredClone(validReceiptFields));
    assert.strictEqual(validate(receiptSchema, { ...record, ...extra }).valid, false);
    record.decision = { ...record.decision, ...extra };
    assert.strictEqual(validate(receiptSchema, record).valid, false);
  });
  check(`inherited ${key} cannot satisfy required; explicitly declared own member can`, () => {
    const schema = JSON.parse(`{"type":"object","properties":{"${key}":{"type":"string"}},"required":["${key}"],"additionalProperties":false}`);
    assert.strictEqual(validate(schema, {}).valid, false);
    assert.strictEqual(validate(schema, JSON.parse(`{"${key}":"own value"}`)).valid, true);
  });
}

check("inherited required record property is missing", () => {
  const record = buildReceiptObject(structuredClone(validReceiptFields));
  delete record.decision.owner;
  Object.setPrototypeOf(record.decision, { owner: "Inherited owner" });
  const result = validate(receiptSchema, record);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('missing required field "owner"')));
});

for (const [input, expected] of [["1.25", 1.25], [".5", 0.5], ["-2.75", -2.75], ["1e2", 100], ["2.5E-2", 0.025], ["0", 0]]) {
  check(`whole numeric input ${input}`, () => assert.strictEqual(parseFormNumber(input), expected));
}
for (const input of ["", " ", "12abc", "1e", "1.2.3", "0x10", "Infinity", "-Infinity", "NaN", "1e400"]) {
  check(`invalid numeric input ${JSON.stringify(input)}`, () => assert.ok(Number.isNaN(parseFormNumber(input))));
}

const rawEvidence = { source: "Finance", metric: "revenue", value: "1.25", unit: "INR", freshness_days: "1e2" };
check("evidence decimals and exponent integers survive JSON export", () => {
  const evidence = parseEvidenceRows([rawEvidence]);
  assert.deepStrictEqual(evidence, [{ source: "Finance", metric: "revenue", value: 1.25, unit: "INR", freshness_days: 100 }]);
  const record = buildReceiptObject({ ...validReceiptFields, evidence });
  assert.strictEqual(validate(receiptSchema, record).valid, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(record)), record);
});
for (const missing of ["source", "metric", "value", "freshness_days"]) {
  check(`partial evidence missing ${missing} is retained and rejected`, () => {
    const evidence = parseEvidenceRows([rawEvidence, { ...rawEvidence, [missing]: "" }]);
    assert.strictEqual(evidence.length, 2);
    const result = validate(receiptSchema, buildReceiptObject({ ...validReceiptFields, evidence }));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes(`evidence[1].${missing}`)));
  });
}
check("only fully empty evidence rows are dropped", () => {
  const empty = { source: "", metric: " ", value: "", unit: "", freshness_days: "" };
  assert.deepStrictEqual(parseEvidenceRows([empty]), []);
  assert.strictEqual(parseEvidenceRows([{ ...empty, value: "0" }]).length, 1);
});
check("fractional integer fields are rejected without truncation", () => {
  const evidence = parseEvidenceRows([{ ...rawEvidence, freshness_days: "1.5" }]);
  assert.strictEqual(evidence[0].freshness_days, 1.5);
  assert.strictEqual(validate(receiptSchema, buildReceiptObject({ ...validReceiptFields, evidence })).valid, false);
  assert.strictEqual(validate(receiptSchema, buildReceiptObject({ ...validReceiptFields, review_after_days: parseFormNumber("1.5") })).valid, false);
});
check("non-browser record builder does not assign a timezone", () => {
  const record = buildReceiptObject({ ...validReceiptFields, evidence_as_of: "2026-09-19T19:00" });
  assert.strictEqual(record.evidence_as_of, "2026-09-19T19:00");
  assert.strictEqual(validate(receiptSchema, record).valid, false);
});

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
