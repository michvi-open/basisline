export class IntegrityError extends Error {
  constructor(code, exitCode = 2, details = {}) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export const DEFAULT_LIMITS = Object.freeze({ maxBytes: 1048576, maxNodes: 100000, maxOutputBytes: 16777216 });

export function limitsFor(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > 67108864) {
      throw new IntegrityError('INVALID_LIMIT');
    }
  }
  return limits;
}

export function snapshot(bytes, maxBytes) {
  if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer) {
    throw new IntegrityError('EXPECTED_UNSHARED_BYTES');
  }
  if (bytes.byteLength > maxBytes) throw new IntegrityError('RESOURCE_BYTES');
  return Uint8Array.from(bytes);
}
