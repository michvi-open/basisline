import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { IntegrityError } from './errors.js';

// Internal adapter: only trees owned by ingest() reach this function. The public
// generate/verify API accepts bytes, never arbitrary objects with toJSON hooks.
export function canonicalBytes(value, limits) {
  const bytes = Buffer.from(canonicalize(value), 'utf8');
  // Necessary for closure under re-ingestion with the same byte budget.
  if (bytes.length > limits.maxBytes) throw new IntegrityError('RESOURCE_CANONICAL_BYTES');
  return bytes;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
