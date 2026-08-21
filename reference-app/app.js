import { validate } from "./lib/validate.js";
import { buildReceiptObject, buildOutcomeObject, linesToArray } from "./lib/form-mapping.js";
import { renderReceiptMarkdown, renderOutcomeMarkdown } from "../renderer/render.js";

// --- tab switching ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// --- schemas: fetched once, schema stays the single source of truth ---
const [receiptSchema, outcomeSchema] = await Promise.all([
  fetch("./schema/decision-receipt.schema.json").then((r) => r.json()),
  fetch("./schema/outcome-record.schema.json").then((r) => r.json()),
]);

// --- evidence rows (Decision Receipt screen) ---
const evidenceRowsEl = document.getElementById("evidence-rows");

function addEvidenceRow() {
  const row = document.createElement("div");
  row.className = "evidence-row";
  row.innerHTML = `
    <input placeholder="Source (e.g. GA4)" class="ev-source" />
    <input placeholder="Metric (e.g. leads)" class="ev-metric" />
    <input placeholder="Value" type="number" class="ev-value" />
    <input placeholder="Unit (e.g. count, INR)" class="ev-unit" />
    <input placeholder="Freshness (days)" type="number" class="ev-freshness" />
    <button type="button" class="remove-row" title="Remove row">&times;</button>
  `;
  row.querySelector(".remove-row").addEventListener("click", () => row.remove());
  evidenceRowsEl.appendChild(row);
}

document.getElementById("add-evidence-row").addEventListener("click", addEvidenceRow);
addEvidenceRow(); // start with one row

function collectEvidence() {
  return Array.from(evidenceRowsEl.querySelectorAll(".evidence-row"))
    .map((row) => ({
      source: row.querySelector(".ev-source").value.trim(),
      metric: row.querySelector(".ev-metric").value.trim(),
      value: parseFloat(row.querySelector(".ev-value").value),
      unit: row.querySelector(".ev-unit").value.trim(),
      freshness_days: parseInt(row.querySelector(".ev-freshness").value, 10),
    }))
    .filter((e) => e.source && e.metric); // drop fully-empty rows
}

// --- generic helpers ---
function showErrors(el, errors) {
  if (errors.length === 0) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = `<strong>This record does not satisfy the Basisline v0.1 schema:</strong><ul>${errors
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join("")}</ul>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Decision Receipt form ---
const receiptForm = document.getElementById("receipt-form");
const receiptErrorsEl = document.getElementById("receipt-errors");
const receiptOutputEl = document.getElementById("receipt-output");
let currentReceipt = null;
let currentReceiptMd = "";

receiptForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const fields = {
    receipt_id: document.getElementById("r-receipt_id").value.trim(),
    summary: document.getElementById("r-summary").value.trim(),
    context: document.getElementById("r-context").value.trim(),
    owner: document.getElementById("r-owner").value.trim(),
    date: document.getElementById("r-date").value,
    confidence: document.getElementById("r-confidence").value,
    evidence: collectEvidence(),
    evidence_as_of: toIsoDateTime(document.getElementById("r-evidence_as_of").value),
    assumptions: linesToArray(document.getElementById("r-assumptions").value),
    known_conflicts: linesToArray(document.getElementById("r-known_conflicts").value),
    review_after_days: parseInt(document.getElementById("r-review_after_days").value, 10),
    supersedes: document.getElementById("r-supersedes").value.trim() || null,
    related_receipt_ids: linesToArray(document.getElementById("r-related").value),
  };

  const record = buildReceiptObject(fields);
  const result = validate(receiptSchema, record);

  showErrors(receiptErrorsEl, result.errors);

  if (!result.valid) {
    receiptOutputEl.hidden = true;
    return;
  }

  currentReceipt = record;
  currentReceiptMd = renderReceiptMarkdown(record);

  document.getElementById("receipt-json-preview").textContent = JSON.stringify(record, null, 2);
  document.getElementById("receipt-md-preview").textContent = currentReceiptMd;
  receiptOutputEl.hidden = false;
});

document.getElementById("dl-receipt-json").addEventListener("click", () => {
  if (!currentReceipt) return;
  download(`${currentReceipt.receipt_id}.json`, JSON.stringify(currentReceipt, null, 2), "application/json");
});

document.getElementById("dl-receipt-md").addEventListener("click", () => {
  if (!currentReceipt) return;
  download(`${currentReceipt.receipt_id}.md`, currentReceiptMd, "text/markdown");
});

// --- Outcome Record form ---
const outcomeForm = document.getElementById("outcome-form");
const outcomeErrorsEl = document.getElementById("outcome-errors");
const outcomeOutputEl = document.getElementById("outcome-output");
let currentOutcome = null;
let currentOutcomeMd = "";

outcomeForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const fields = {
    outcome_id: document.getElementById("o-outcome_id").value.trim(),
    receipt_id: document.getElementById("o-receipt_id").value.trim(),
    recorded_on: document.getElementById("o-recorded_on").value,
    actual_result: document.getElementById("o-actual_result").value.trim(),
    learning: document.getElementById("o-learning").value.trim(),
  };

  const record = buildOutcomeObject(fields);
  const result = validate(outcomeSchema, record);

  showErrors(outcomeErrorsEl, result.errors);

  if (!result.valid) {
    outcomeOutputEl.hidden = true;
    return;
  }

  currentOutcome = record;
  currentOutcomeMd = renderOutcomeMarkdown(record);

  document.getElementById("outcome-json-preview").textContent = JSON.stringify(record, null, 2);
  document.getElementById("outcome-md-preview").textContent = currentOutcomeMd;
  outcomeOutputEl.hidden = false;
});

document.getElementById("dl-outcome-json").addEventListener("click", () => {
  if (!currentOutcome) return;
  download(`${currentOutcome.outcome_id}.json`, JSON.stringify(currentOutcome, null, 2), "application/json");
});

document.getElementById("dl-outcome-md").addEventListener("click", () => {
  if (!currentOutcome) return;
  download(`${currentOutcome.outcome_id}.md`, currentOutcomeMd, "text/markdown");
});

// datetime-local input gives "2026-08-20T10:00" (no seconds, no timezone) —
// normalize to the schema's required ISO 8601 date-time format.
function toIsoDateTime(localValue) {
  if (!localValue) return "";
  return localValue.length === 16 ? `${localValue}:00Z` : localValue;
}
