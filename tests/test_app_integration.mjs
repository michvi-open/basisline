// Run the actual app module and submit handler with a minimal DOM/fetch adapter.
// This checks application wiring, not a browser's native input UI/constraints.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--timezone-child")) {
  for (const timezone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--timezone-child"], {
      env: { ...process.env, TZ: timezone }, encoding: "utf8",
    });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `app tests failed in ${timezone}`);
  }
} else {
  class Element {
    value = "";
    hidden = true;
    textContent = "";
    innerHTML = "";
    children = [];
    selectors = new Map();
    listeners = new Map();
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    appendChild(child) { this.children.push(child); }
    querySelectorAll() { return this.children; }
    querySelector(selector) {
      if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
      return this.selectors.get(selector);
    }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  globalThis.document = {
    querySelectorAll: () => [],
    getElementById: get,
    createElement: () => new Element(),
  };
  globalThis.fetch = async (url) => ({
    json: async () => JSON.parse(readFileSync(new URL(`../reference-app/${url}`, import.meta.url))),
  });
  await import("../reference-app/app.js");

  for (const [name, value] of Object.entries({
    receipt_id: "bl_2026-09-19_test", summary: "Test", context: "Context", owner: "Owner",
    date: "2026-09-19", confidence: "medium", assumptions: "Assumption", review_after_days: "1e2",
  })) get(`r-${name}`).value = value;
  const row = get("evidence-rows").children[0];
  assert.match(row.innerHTML, /type="number" step="any" class="ev-value"/);
  for (const [name, value] of Object.entries({ source: "Finance", metric: "value", value: "1.25", unit: "INR", freshness: "1e2" })) {
    row.querySelector(`.ev-${name}`).value = value;
  }
  const submit = () => get("receipt-form").listeners.get("submit")({ preventDefault() {} });
  const timestampCases = {
    UTC: [["2026-09-19T19:00", "2026-09-19T19:00:00.000Z"], ["2026-09-19T19:00:30.125", "2026-09-19T19:00:30.125Z"]],
    "Asia/Kolkata": [["2026-09-19T19:00", "2026-09-19T13:30:00.000Z"], ["2026-09-19T19:00:30", "2026-09-19T13:30:30.000Z"]],
    "America/New_York": [["2026-01-19T19:00", "2026-01-20T00:00:00.000Z"], ["2026-07-19T19:00", "2026-07-19T23:00:00.000Z"], ["2026-11-01T01:30", "2026-11-01T05:30:00.000Z"]],
  }[process.env.TZ];
  for (const [input, expected] of timestampCases) {
    get("r-evidence_as_of").value = input;
    submit();
    assert.strictEqual(get("receipt-output").hidden, false, get("receipt-errors").innerHTML);
    const record = JSON.parse(get("receipt-json-preview").textContent);
    assert.strictEqual(record.evidence_as_of, expected);
    assert.strictEqual(record.evidence[0].value, 1.25);
    assert.strictEqual(record.evidence[0].freshness_days, 100);
    assert.strictEqual(record.review_after_days, 100);
    console.log(`[PASS] app ${process.env.TZ}: ${input} -> ${expected}; decimal/exponent values preserved`);
  }
  const badTimes = ["2026-02-30T12:00", "", "invalid", "2026-09-19T19:00Z"];
  if (process.env.TZ === "America/New_York") badTimes.push("2026-03-08T02:30");
  for (const input of badTimes) {
    get("r-evidence_as_of").value = input;
    submit();
    assert.strictEqual(get("receipt-output").hidden, true);
    assert.match(get("receipt-errors").innerHTML, /Evidence as of/);
  }
  get("r-evidence_as_of").value = "2026-09-19T19:00";
  for (const selector of [".ev-source", ".ev-metric", ".ev-value"]) {
    const input = row.querySelector(selector);
    const previous = input.value;
    input.value = "";
    submit();
    assert.strictEqual(get("receipt-output").hidden, true);
    assert.match(get("receipt-errors").innerHTML, /evidence\[0\]/);
    input.value = previous;
  }
  console.log(`[PASS] app ${process.env.TZ}: invalid/local-gap times and incomplete evidence blocked`);
}
