import { newReport, prepareRecord, finish, failedCheck, metadataConstants, recordId } from './verify.js';
import { limitsFor, IntegrityError } from './errors.js';
import { renderProfile } from '../renderer/profile-0.1.js';

export function generateArtifacts({ recordBytes, limits: options = {} } = {}) {
  const report = newReport('generation');
  for (const key of ['metadata_input','metadata_schema','record_binding','fingerprint_match','expected_digest','relationships']) report.checks[key] = { status: 'not_requested' };
  try {
    const limits = limitsFor(options);
    const prepared = prepareRecord(recordBytes, limits, report);
    if (prepared) {
      const { record, digest } = prepared;
      const metadata = {
        basisline_integrity_version: metadataConstants.basisline_integrity_version,
        record_id: recordId(record), record_type: record.record_type,
        canonicalization: metadataConstants.canonicalization, hash_algorithm: metadataConstants.hash_algorithm,
        digest_encoding: metadataConstants.digest_encoding, digest,
      };
      const integrityBytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n', 'utf8');
      if (integrityBytes.length > limits.maxBytes) throw new IntegrityError('RESOURCE_METADATA_BYTES');
      const markdownBytes = renderProfile(record, limits.maxOutputBytes);
      report.checks.markdown_match = { status: 'pass', code: 'PROJECTION_GENERATED' };
      report.record_id = recordId(record);
      report.computed_digest = digest;
      return { report: finish(report), integrityBytes, markdownBytes };
    }
  } catch (error) { report.checks.operation = failedCheck(error); }
  return { report: finish(report) };
}
