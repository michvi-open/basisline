/**
 * Basisline v0.1 renderer — turns a Decision Receipt or Outcome Record
 * (as defined in spec/v0.1.md) into human-readable Markdown.
 *
 * No dependencies. Works unmodified in a browser <script type="module">
 * or in Node (see package.json "type": "module").
 */

/**
 * Formats a typed {value, unit} pair for human display.
 * INR gets lakh/crore formatting since that's the common convention
 * for the amounts Basisline receipts are likely to carry in this context.
 * Every other unit is shown as "<value> <unit>", and "count" is shown
 * as a bare number.
 */
export function formatValue(value, unit) {
  if (unit === "INR") {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)}Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1)}L`;
    return `₹${value.toLocaleString("en-IN")}`;
  }
  if (unit === "count") return `${value}`;
  return `${value} ${unit}`;
}

function metricToLabel(metric) {
  return metric.replace(/_/g, " ");
}

/**
 * Renders a Decision Receipt as Markdown.
 * @param {object} receipt - a record with record_type === "receipt"
 */
export function renderReceiptMarkdown(receipt) {
  if (receipt.record_type !== "receipt") {
    throw new Error(`Expected record_type "receipt", got "${receipt.record_type}"`);
  }

  const lines = [];
  lines.push(`## Decision: ${receipt.decision.summary}`);
  lines.push(`**Context:** ${receipt.decision.context}`);
  lines.push(
    `**Owner:** ${receipt.decision.owner} · **Date:** ${receipt.decision.date} · **Confidence:** ${capitalize(receipt.decision.confidence)}`
  );
  lines.push("");

  lines.push(`**Evidence (as of ${receipt.evidence_as_of.slice(0, 10)}):**`);
  for (const e of receipt.evidence) {
    lines.push(`- ${e.source} ${metricToLabel(e.metric)}: ${formatValue(e.value, e.unit)}`);
  }
  lines.push("");

  lines.push(`**Assumptions:**`);
  for (const a of receipt.assumptions) {
    lines.push(`- ${a}`);
  }
  lines.push("");

  if (receipt.known_conflicts && receipt.known_conflicts.length > 0) {
    if (receipt.known_conflicts.length === 1) {
      lines.push(`**Known conflict:** ${receipt.known_conflicts[0]}`);
    } else {
      lines.push(`**Known conflicts:**`);
      for (const c of receipt.known_conflicts) lines.push(`- ${c}`);
    }
    lines.push("");
  }

  lines.push(`**Review after:** ${receipt.review_after_days} days`);

  if (receipt.revision && receipt.revision.supersedes) {
    lines.push("");
    lines.push(`_Supersedes: ${receipt.revision.supersedes}_`);
  }

  return lines.join("\n");
}

/**
 * Renders an Outcome Record as a Markdown block, meant to be appended
 * after its linked receipt's rendering (see renderCombinedMarkdown).
 * @param {object} outcome - a record with record_type === "outcome"
 */
export function renderOutcomeMarkdown(outcome) {
  if (outcome.record_type !== "outcome") {
    throw new Error(`Expected record_type "outcome", got "${outcome.record_type}"`);
  }

  const lines = [];
  lines.push(`### Outcome — recorded ${outcome.recorded_on}`);
  lines.push(`**Result:** ${outcome.actual_result}`);
  lines.push(`**Learning:** ${outcome.learning}`);
  return lines.join("\n");
}

/**
 * Renders a receipt together with its outcome (if any), matching the
 * combined example in spec/v0.1.md section 4.5.
 * @param {object} receipt
 * @param {object|null} outcome - pass null if no outcome exists yet
 */
export function renderCombinedMarkdown(receipt, outcome) {
  const parts = [renderReceiptMarkdown(receipt)];
  if (outcome) {
    if (outcome.receipt_id !== receipt.receipt_id) {
      throw new Error(
        `Outcome references receipt_id "${outcome.receipt_id}" but was rendered against "${receipt.receipt_id}"`
      );
    }
    parts.push("---");
    parts.push(renderOutcomeMarkdown(outcome));
  } else {
    parts.push("---");
    parts.push("_Outcome not yet recorded._");
  }
  return parts.join("\n");
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
