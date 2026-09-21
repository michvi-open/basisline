// Report-only limits: these never change record validation or fingerprints.
export const REPORT_LIMITS = Object.freeze({
  maxDiagnostics: 20, maxStringBytes: 1024, maxDetailEntries: 128,
  maxDetailDepth: 4, maxDetailNodes: 1024, maxDetailBytes: 32768,
  maxMaterialBytes: 65536, maxReportBytes: 262144,
});

const budgets = new WeakMap();
const terminalControl = /[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
const escaped = c => terminalControl.test(c)
  ? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  : JSON.stringify(c).slice(1, -1);

function budgetFor(report) {
  if (!report) return { bytes: REPORT_LIMITS.maxMaterialBytes };
  if (!budgets.has(report)) budgets.set(report, { bytes: REPORT_LIMITS.maxMaterialBytes });
  return budgets.get(report);
}

// Consume only the bounded prefix. Do not slice/escape an entire source string.
function textPrefix(characters, limit) {
  let value = '', bytes = 2;
  for (const c of characters) {
    const cost = Buffer.byteLength(escaped(c));
    if (bytes + cost > limit) return { value, bytes, truncated: true };
    value += c; bytes += cost;
  }
  return { value, bytes, truncated: false };
}

export function reportPointer(path) {
  function* characters() {
    for (const part of path) {
      yield '/';
      for (const c of String(part)) yield* c === '~' ? '~0' : c === '/' ? '~1' : c;
    }
  }
  const result = textPrefix(characters(), REPORT_LIMITS.maxStringBytes);
  return { path: result.value, ...(result.truncated ? { path_truncated: true } : {}) };
}

// Copy optional report material with shared byte accounting and local traversal
// bounds. No Object.entries() allocation over an attacker-sized collection.
export function copyReportDetail(value, report) {
  const shared = budgetFor(report);
  let remaining = Math.min(shared.bytes, REPORT_LIMITS.maxDetailBytes), nodes = 0, truncated = false;
  const initial = remaining;
  const spend = n => { if (remaining < n) { truncated = true; return false; } remaining -= n; return true; };
  const omit = () => { truncated = true; return null; };
  function copy(v, depth) {
    if (++nodes > REPORT_LIMITS.maxDetailNodes || !spend(4)) return omit();
    if (typeof v === 'string') {
      if (remaining < 2) return omit();
      const t = textPrefix(v, Math.min(remaining, REPORT_LIMITS.maxStringBytes));
      spend(t.bytes); truncated ||= t.truncated;
      return t.value;
    }
    if (v === null || typeof v === 'boolean') return spend(v === false ? 5 : 4) ? v : omit();
    if (typeof v === 'number' && Number.isFinite(v)) {
      return spend(24) ? v : omit();
    }
    if (typeof v !== 'object' || depth >= REPORT_LIMITS.maxDetailDepth) return omit();
    const array = Array.isArray(v), out = array ? [] : {};
    let count = 0;
    if (array) {
      for (let i = 0; i < v.length; i++) {
        if (count++ >= REPORT_LIMITS.maxDetailEntries || nodes >= REPORT_LIMITS.maxDetailNodes || remaining < 8) { truncated = true; break; }
        out.push(copy(v[i], depth + 1));
      }
    } else {
      for (const key in v) {
        if (!Object.hasOwn(v, key)) continue;
        if (count++ >= REPORT_LIMITS.maxDetailEntries || nodes >= REPORT_LIMITS.maxDetailNodes || remaining < 8) { truncated = true; break; }
        const k = textPrefix(key, Math.min(remaining, REPORT_LIMITS.maxStringBytes));
        // Never turn truncated keys into collisions or misleading property names.
        if (k.truncated) { truncated = true; continue; }
        spend(k.bytes);
        Object.defineProperty(out, key, { value: copy(v[key], depth + 1), enumerable: true, writable: true, configurable: true });
      }
    }
    return out;
  }
  const result = copy(value, 0);
  shared.bytes -= initial - remaining;
  if (truncated && report) report.report_truncated = true;
  return { value: result, truncated };
}

export function setReportValue(report, key, value) {
  const copied = copyReportDetail(value, report);
  report[key] = copied.value;
  if (copied.truncated) report[key + '_truncated'] = true;
}

// The factory is lazy: once full, even path traversal/escaping is skipped.
export function addDiagnostic(report, makeDiagnostic) {
  if (report.diagnostics.length >= REPORT_LIMITS.maxDiagnostics) {
    report.diagnostics_truncated = true;
    report.report_truncated = true;
    return;
  }
  const diagnostic = makeDiagnostic();
  const copied = copyReportDetail(diagnostic, report);
  if (copied.value) report.diagnostics.push(copied.value);
  if (copied.truncated || diagnostic.path_truncated) {
    report.diagnostics_truncated = true;
    report.report_truncated = true;
  }
}

// Defense in depth: bounded incremental JSON encoding, including terminal
// escaping and the final LF. Never stringify a potentially large report first.
export function serializeReport(report) {
  let size = 1, nodes = 0, chunk = '';
  const parts = [];
  function append(s) {
    size += Buffer.byteLength(s);
    if (size > REPORT_LIMITS.maxReportBytes) throw new Error('REPORT_RESOURCE_LIMIT');
    chunk += s;
    if (chunk.length >= 4096) { parts.push(chunk); chunk = ''; }
  }
  function string(s) { append('"'); for (const c of s) append(escaped(c)); append('"'); }
  function visit(v, depth) {
    if (++nodes > 8192 || depth > 8) throw new Error('REPORT_RESOURCE_LIMIT');
    if (typeof v === 'string') { string(v); return; }
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) { append(JSON.stringify(v)); return; }
    if (!v || typeof v !== 'object') throw new Error('REPORT_RESOURCE_LIMIT');
    const array = Array.isArray(v);
    append(array ? '[' : '{');
    let count = 0;
    const member = (key, val) => {
      if (++count > REPORT_LIMITS.maxDetailEntries) throw new Error('REPORT_RESOURCE_LIMIT');
      if (count > 1) append(',');
      if (!array) { string(key); append(':'); }
      visit(val, depth + 1);
    };
    if (array) { for (const val of v) member('', val); }
    else { for (const key in v) if (Object.hasOwn(v, key) && v[key] !== undefined) member(key, v[key]); }
    append(array ? ']' : '}');
  }
  try {
    visit(report, 0);
    parts.push(chunk);
    return { text: parts.join('') + '\n', exitCode: report.exit_code };
  } catch {
    // Preserve higher-priority missing/I/O results; reporting cannot turn a
    // failed prerequisite into success or downgrade exit 3/4 to exit 2.
    const exitCode = [3, 4].includes(report.exit_code) ? report.exit_code : 2;
    return { exitCode, text: JSON.stringify({
      report_version: '0.1', result: 'incomplete', exit_code: exitCode,
      code: 'REPORT_RESOURCE_LIMIT', report_truncated: true,
      assurance: { historical_existence: 'not_established', authorship: 'not_established', currentness: 'not_established', history_completeness: 'not_established' },
    }) + '\n' };
  }
}
