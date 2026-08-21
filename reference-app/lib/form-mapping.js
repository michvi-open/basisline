/**
 * Pure, DOM-free functions that assemble Basisline record objects from
 * already-parsed form values. Kept separate from app.js so they can be
 * unit tested under Node without a browser.
 */

/**
 * Splits a textarea's contents into a clean array of non-empty lines.
 * Used for assumptions, known_conflicts, related_receipt_ids.
 */
export function linesToArray(text) {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {object} fields
 * @param {string} fields.receipt_id
 * @param {string} fields.summary
 * @param {string} fields.context
 * @param {string} fields.owner
 * @param {string} fields.date
 * @param {string} fields.confidence
 * @param {Array<{source:string, metric:string, value:number, unit:string, freshness_days:number}>} fields.evidence
 * @param {string} fields.evidence_as_of
 * @param {string[]} fields.assumptions
 * @param {string[]} [fields.known_conflicts]
 * @param {number} fields.review_after_days
 * @param {string|null} [fields.supersedes]
 * @param {string[]} [fields.related_receipt_ids]
 */
export function buildReceiptObject(fields) {
  const record = {
    basisline_version: "0.1",
    record_type: "receipt",
    receipt_id: fields.receipt_id,
    decision: {
      summary: fields.summary,
      context: fields.context,
      owner: fields.owner,
      date: fields.date,
      confidence: fields.confidence,
    },
    evidence: fields.evidence || [],
    evidence_as_of: fields.evidence_as_of,
    assumptions: fields.assumptions || [],
    review_after_days: fields.review_after_days,
  };

  if (fields.known_conflicts && fields.known_conflicts.length > 0) {
    record.known_conflicts = fields.known_conflicts;
  }

  if (
    (fields.supersedes && fields.supersedes.length > 0) ||
    (fields.related_receipt_ids && fields.related_receipt_ids.length > 0)
  ) {
    record.revision = {
      supersedes: fields.supersedes || null,
      related_receipt_ids: fields.related_receipt_ids || [],
    };
  }

  return record;
}

/**
 * @param {object} fields
 * @param {string} fields.outcome_id
 * @param {string} fields.receipt_id
 * @param {string} fields.recorded_on
 * @param {string} fields.actual_result
 * @param {string} fields.learning
 */
export function buildOutcomeObject(fields) {
  return {
    basisline_version: "0.1",
    record_type: "outcome",
    outcome_id: fields.outcome_id,
    receipt_id: fields.receipt_id,
    recorded_on: fields.recorded_on,
    actual_result: fields.actual_result,
    learning: fields.learning,
  };
}
