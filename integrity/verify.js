import { readFileSync } from 'node:fs';
import { validate } from '../reference-app/lib/validate.js';
import { ingest, pointer } from './ingest.js';
import { IntegrityError, limitsFor, snapshot } from './errors.js';
import { canonicalBytes, sha256 } from './canonicalize.js';
import { renderProfile } from '../renderer/profile-0.1.js';

const schema = name => JSON.parse(readFileSync(new URL('../schema/' + name, import.meta.url), 'utf8'));
const schemas = Object.freeze({ receipt: schema('decision-receipt.schema.json'), outcome: schema('outcome-record.schema.json') });
const metadataSchema = schema('integrity-metadata.schema.json');
const constants = Object.freeze({ basisline_integrity_version: '0.1', canonicalization: 'RFC8785', hash_algorithm: 'SHA-256', digest_encoding: 'hex-lower' });
const checks = ['record_input','metadata_input','record_schema','numeric_profile','metadata_schema','record_binding','canonicalization','fingerprint_match','markdown_match','expected_digest','relationships'];

export function newReport(scope = 'supplied-triplet') {
  return {
    report_version: '0.1', scope, result: 'incomplete', exit_code: 2,
    basisline_integrity_version: '0.1', renderer_profile: '0.1',
    checks: Object.fromEntries(checks.map(c => [c, { status: 'skipped' }])), diagnostics: [],
    assurance: { historical_existence: 'not_established', authorship: 'not_established', currentness: 'not_established', history_completeness: 'not_established' },
  };
}

export function finish(report) {
  const codes = Object.values(report.checks).map(c => c.exit_code || 0);
  report.exit_code = [4, 3, 2, 1].find(c => codes.includes(c)) || 0;
  report.result = report.exit_code === 0 ? 'checks_passed' : report.exit_code === 1 ? 'checks_failed' : 'incomplete';
  return report;
}

export function failedCheck(error) {
  if (!(error instanceof IntegrityError)) return { status: 'fail', code: 'TOOL_FAILURE', exit_code: 4 };
  const status = error.code === 'SCHEMA_FORMAT_UNRESOLVED' ? 'unresolved' : error.exitCode === 2 ? 'unsupported' : 'fail';
  return { status, code: error.code, exit_code: error.exitCode, ...error.details };
}

function attempt(report, name, operation) {
  try { const result = operation(); report.checks[name] = { status: 'pass' }; return result; }
  catch (error) { report.checks[name] = failedCheck(error); return undefined; }
}

function validateRecord(parsed) {
  const r = parsed.value;
  if (!r || Array.isArray(r) || typeof r !== 'object') throw new IntegrityError('RECORD_SCHEMA', 1);
  if (typeof r.record_type !== 'string' || typeof r.basisline_version !== 'string') throw new IntegrityError('RECORD_SCHEMA', 1);
  if (!Object.hasOwn(schemas, r.record_type) || r.basisline_version !== '0.1') throw new IntegrityError('RECORD_VERSION_OR_TYPE');
  // The legacy validator interpolates enum errors before checking types.
  // Null-prototype objects cannot be coerced to strings; classify the actual
  // schema failure here rather than misreporting an internal tool failure.
  if (r.record_type === 'receipt' && typeof r.decision?.confidence !== 'string') throw new IntegrityError('RECORD_SCHEMA', 1);
  if (!validate(schemas[r.record_type], r).valid) throw new IntegrityError('RECORD_SCHEMA', 1);
  const paths = r.record_type === 'receipt' ? [['decision','date'], ['evidence_as_of']] : [['recorded_on']];
  for (const path of paths) {
    const value = path.reduce((v, k) => v[k], r);
    if (value.startsWith('0000-') || /[Tt]\d{2}:\d{2}:60/.test(value)) {
      throw new IntegrityError('SCHEMA_FORMAT_UNRESOLVED', 2, { path: pointer(path) });
    }
  }
  return r;
}

function integerFields(parsed) {
  for (const [path, info] of parsed.numbers) {
    const integerField = (path.length === 1 && path[0] === 'review_after_days') ||
      (path.length === 3 && path[0] === 'evidence' && path[2] === 'freshness_days' && /^\d+$/.test(path[1]));
    if (integerField && !info.integer) {
      throw new IntegrityError('RAW_INTEGER_REQUIRED', 1, { path: pointer(path) });
    }
  }
  return true;
}

function validateMetadata(parsed) {
  const m = parsed.value;
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new IntegrityError('METADATA_SCHEMA', 1);
  for (const [key, expected] of Object.entries(constants)) {
    if (Object.hasOwn(m, key) && m[key] !== expected) throw new IntegrityError('UNSUPPORTED_INTEGRITY_PROFILE');
  }
  if (typeof m.record_type !== 'string') throw new IntegrityError('METADATA_SCHEMA', 1);
  if (!validate(metadataSchema, m).valid || m.digest.length !== 64) throw new IntegrityError('METADATA_SCHEMA', 1);
  return m;
}

export const recordId = r => r.record_type === 'receipt' ? r.receipt_id : r.outcome_id;

export function prepareRecord(recordBytes, limits, report) {
  if (recordBytes === undefined) {
    report.checks.record_input = failedCheck(new IntegrityError('RECORD_MISSING', 3));
    return undefined;
  }
  const parsed = attempt(report, 'record_input', () => ingest(recordBytes, limits));
  if (!parsed) return undefined;
  const numeric = attempt(report, 'numeric_profile', () => integerFields(parsed));
  const record = attempt(report, 'record_schema', () => validateRecord(parsed));
  for (const [path, info] of parsed.numbers) {
    if (info.rounded && report.diagnostics.length < 20) report.diagnostics.push({ code: 'DECIMAL_ROUNDING', path: pointer(path) });
  }
  if (!numeric || !record) return undefined;
  const bytes = attempt(report, 'canonicalization', () => canonicalBytes(record, limits));
  return bytes ? { record, bytes, digest: sha256(bytes) } : undefined;
}

function observeRelationships(all, report) {
  const seen = new Map(), superseded = new Map();
  const observations = [];
  for (const p of all) {
    const id = recordId(p.record);
    if (seen.has(id) && seen.get(id).digest !== p.digest) throw new IntegrityError('SAME_ID_DIFFERENT_DIGEST', 1);
    seen.set(id, p);
    if (p.record.record_type === 'receipt' && p.record.revision?.supersedes) {
      const prior = p.record.revision.supersedes;
      const children = superseded.get(prior) || new Set();
      children.add(id); superseded.set(prior, children);
    }
  }
  for (const children of superseded.values()) if (children.size > 1) observations.push({ code: 'REVISION_FORK' });
  for (const p of all) {
    const r = p.record;
    if (r.record_type === 'outcome') {
      const target = seen.get(r.receipt_id);
      if (!target || target.record.record_type !== 'receipt') observations.push({ code: 'REFERENCED_RECEIPT_NOT_SUPPLIED' });
      else observations.push({ code: 'RECEIPT_ID_MATCH_ONLY' });
    } else if (r.revision?.supersedes) {
      const visited = new Set([recordId(r)]);
      let next = r.revision.supersedes;
      while (next) {
        if (visited.has(next)) { observations.push({ code: 'REVISION_CYCLE' }); break; }
        visited.add(next);
        const target = seen.get(next);
        if (!target) { observations.push({ code: 'SUPERSEDED_RECEIPT_NOT_SUPPLIED' }); break; }
        if (target.record.record_type !== 'receipt') {
          observations.push({ code: 'REVISION_TARGET_TYPE_MISMATCH' }); break;
        }
        next = target.record.revision?.supersedes;
      }
    }
  }
  report.diagnostics.push(...observations.slice(0, Math.max(0, 20 - report.diagnostics.length)));
  return true;
}

function relationships(prepared, related, receiptBytes, report, limits) {
  const all = prepared ? [prepared] : [], causes = [];
  let invalidInput = false;
  const classify = (bytes, input, index) => {
    const local = newReport(input);
    let p;
    try { p = prepareRecord(bytes, limits, local); }
    catch (error) { local.checks.operation = failedCheck(error); }
    for (const [check, failure] of Object.entries(local.checks)) {
      if (failure.exit_code) {
        invalidInput = true;
        causes.push({ input, index, check, ...failure });
      }
    }
    if (p) all.push(p);
    return p;
  };
  // Every independent input is classified before failures are reduced. The
  // existing 32-record bound plus one explicit receipt bounds the cause list;
  // causes are not lost to the separate 20-observation diagnostic budget.
  const reference = receiptBytes === undefined ? undefined : classify(receiptBytes, 'receipt-reference', 0);
  for (const [index, bytes] of related.entries()) classify(bytes, 'related-record', index);
  if (prepared && reference && (prepared.record.record_type !== 'outcome' ||
      reference.record.record_type !== 'receipt' || prepared.record.receipt_id !== reference.record.receipt_id)) {
    causes.push({ check: 'receipt_binding', ...failedCheck(new IntegrityError('RECEIPT_RELATIONSHIP_MISMATCH', 1)) });
  }
  // Retain genuine conflicts among successfully classified records even when
  // another supplied record was invalid or unresolved.
  if (prepared) {
    try { observeRelationships(all, report); }
    catch (error) { causes.push({ check: 'record_relationships', ...failedCheck(error) }); }
  }
  if (causes.length) {
    const aggregate = { checks: Object.fromEntries(causes.map((cause, i) => [i, cause])) };
    throw new IntegrityError(invalidInput ? 'RELATED_RECORD_INVALID' : causes[0].code,
      finish(aggregate).exit_code, { causes });
  }
  return Boolean(prepared);
}

export function verifyArtifacts({ recordBytes, integrityBytes, markdownBytes, recordOnly = false, expectedDigest, receiptBytes, relatedRecords = [], limits: options = {} } = {}) {
  const report = newReport(recordOnly ? 'record-and-fingerprint' : 'supplied-triplet');
  report.checks.expected_digest = { status: expectedDigest === undefined ? 'not_requested' : 'skipped' };
  report.checks.relationships = { status: receiptBytes !== undefined || (Array.isArray(relatedRecords) && relatedRecords.length) ? 'skipped' : 'not_requested' };
  if (recordOnly) report.checks.markdown_match = { status: 'not_requested' };
  try {
    const limits = limitsFor(options);
    if (typeof recordOnly !== 'boolean' || !Array.isArray(relatedRecords) || relatedRecords.length > 32) throw new IntegrityError('INVALID_SCOPE_OR_RELATED_LIMIT');
    if (expectedDigest !== undefined && (typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/.test(expectedDigest) || expectedDigest.length !== 64)) throw new IntegrityError('EXPECTED_DIGEST_INVALID');
    const prepared = prepareRecord(recordBytes, limits, report);
    let meta;
    if (integrityBytes === undefined) report.checks.metadata_input = failedCheck(new IntegrityError('METADATA_MISSING', 3));
    else {
      const parsed = attempt(report, 'metadata_input', () => ingest(integrityBytes, limits, 1));
      if (parsed) meta = attempt(report, 'metadata_schema', () => validateMetadata(parsed));
    }
    let markdown;
    if (!recordOnly) {
      if (markdownBytes === undefined) report.checks.markdown_match = failedCheck(new IntegrityError('MARKDOWN_MISSING', 3));
      else {
        try { markdown = snapshot(markdownBytes, limits.maxOutputBytes); }
        catch (e) { report.checks.markdown_match = failedCheck(e); }
      }
    }
    if (prepared) {
      report.record_id = recordId(prepared.record);
      report.computed_digest = prepared.digest;
      if (meta) {
        attempt(report, 'record_binding', () => {
          if (meta.record_id !== report.record_id || meta.record_type !== prepared.record.record_type) throw new IntegrityError('RECORD_BINDING_MISMATCH', 1);
        });
        attempt(report, 'fingerprint_match', () => {
          if (meta.digest !== prepared.digest) throw new IntegrityError('FINGERPRINT_MISMATCH', 1);
        });
      }
      if (meta && markdown) attempt(report, 'markdown_match', () => {
        if (!renderProfile(prepared.record, limits.maxOutputBytes).equals(Buffer.from(markdown))) throw new IntegrityError('MARKDOWN_BYTES_DIFFER', 1);
      });
      if (expectedDigest !== undefined) attempt(report, 'expected_digest', () => {
        if (prepared.digest !== expectedDigest) throw new IntegrityError('EXPECTED_DIGEST_MISMATCH', 1);
      });
    }
    if (receiptBytes !== undefined || relatedRecords.length) {
      const completed = attempt(report, 'relationships', () => relationships(prepared, relatedRecords, receiptBytes, report, limits));
      if (completed === false) report.checks.relationships = { status: 'skipped' };
    }
  } catch (error) { report.checks.operation = failedCheck(error); }
  return finish(report);
}

export { constants as metadataConstants };
