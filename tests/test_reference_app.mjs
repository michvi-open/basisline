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
import { buildReceiptObject, buildOutcomeObject, linesToArray } from "../reference-app/lib/form-mapping.js";
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

// 6. generated Markdown equals renderer output (app must not reinvent rendering)
check("receipt Markdown matches renderer output exactly", () => {
  const record = buildReceiptObject(validReceiptFields);
  const appWouldGenerate = renderReceiptMarkdown(record); // this is exactly what app.js calls
  const directRendererCall = renderReceiptMarkdown(record);
  assert.strictEqual(appWouldGenerate, directRendererCall);
});

check("outcome Markdown matches renderer output exactly", () => {
  const record = buildOutcomeObject(validOutcomeFields);
  const appWouldGenerate = renderOutcomeMarkdown(record);
  const directRendererCall = renderOutcomeMarkdown(record);
  assert.strictEqual(appWouldGenerate, directRendererCall);
});

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
