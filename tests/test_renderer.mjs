/**
 * Locks the renderer's output to its own deterministic behavior —
 * not to the hand-polished prose in spec/v0.1.md section 4.5.
 *
 * Principle: source data in -> deterministic rendering out.
 * The renderer does not normalize spelling, invent punctuation, or
 * otherwise "improve" source strings. If this test and the spec's
 * illustrative Markdown ever diverge in cosmetics (spelling, trailing
 * punctuation), that's expected — the spec's prose will eventually be
 * regenerated from this implementation, not the other way around.
 *
 * Usage: node tests/test_renderer.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import assert from "assert";

import { renderReceiptMarkdown, renderOutcomeMarkdown, renderCombinedMarkdown, formatValue } from "../renderer/render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const receipt = JSON.parse(readFileSync(join(ROOT, "examples/marketing-budget-receipt.json")));
const outcome = JSON.parse(readFileSync(join(ROOT, "examples/marketing-budget-outcome.json")));

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.log(`[FAIL] ${name}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// --- formatValue: deterministic, unit-driven, no locale surprises ---
check("formatValue INR lakh", formatValue(1820000, "INR"), "₹18.2L");
check("formatValue INR crore", formatValue(12000000, "INR"), "₹1.20Cr");
check("formatValue INR small", formatValue(5000, "INR"), "₹5,000");
check("formatValue count", formatValue(420, "count"), "420");
check("formatValue other unit", formatValue(3, "days"), "3 days");

// --- renderReceiptMarkdown: exact deterministic output ---
const expectedReceiptMd = `## Decision: Increase Google Ads budget by ₹5 lakh
**Context:** Marketing budget allocation for Q3 2026
**Owner:** Marketing Head · **Date:** 2026-08-20 · **Confidence:** Medium

**Evidence (as of 2026-08-20):**
- GA4 leads: 420
- CRM qualified leads: 61
- Finance recognized revenue: ₹18.2L

**Assumptions:**
- CRM-qualified lead rate stays consistent with the last 60 days
- Ad platform attribution roughly reflects real conversions

**Known conflict:** Google Ads platform attributed 690 conversions — 570% higher than CRM-qualified count

**Review after:** 30 days`;

check("renderReceiptMarkdown deterministic output", renderReceiptMarkdown(receipt), expectedReceiptMd);

// --- renderOutcomeMarkdown: exact deterministic output ---
const expectedOutcomeMd = `### Outcome — recorded 2026-09-20
**Result:** Recognised revenue was ₹11.4 lakh
**Learning:** Platform attribution materially overstated CRM-confirmed commercial outcomes`;

check("renderOutcomeMarkdown deterministic output", renderOutcomeMarkdown(outcome), expectedOutcomeMd);

// --- renderCombinedMarkdown: receipt + outcome joined ---
check(
  "renderCombinedMarkdown joins receipt and outcome",
  renderCombinedMarkdown(receipt, outcome),
  `${expectedReceiptMd}\n---\n${expectedOutcomeMd}`
);

// --- renderCombinedMarkdown: no outcome yet ---
check(
  "renderCombinedMarkdown with no outcome",
  renderCombinedMarkdown(receipt, null),
  `${expectedReceiptMd}\n---\n_Outcome not yet recorded._`
);

// --- guard: outcome must reference the receipt it's rendered against ---
try {
  renderCombinedMarkdown(receipt, { ...outcome, receipt_id: "bl_wrong_id" });
  console.log("[FAIL] renderCombinedMarkdown should throw on mismatched receipt_id");
  failed++;
} catch (e) {
  console.log("[PASS] renderCombinedMarkdown throws on mismatched receipt_id");
  passed++;
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
