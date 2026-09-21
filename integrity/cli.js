#!/usr/bin/env node
// Load reporting inside the startup boundary, like the verification modules.
let encodeReport;

async function run(argv) {
  const { newReport, failedCheck, finish, verifyArtifacts } = await import('./verify.js');
  const { generateArtifacts } = await import('./generate.js');
  const { readCaptured, writeCompanions } = await import('./files.js');
  const { IntegrityError, limitsFor } = await import('./errors.js');
  const { serializeReport, setReportValue, copyReportDetail } = await import('./report.js');
  encodeReport = serializeReport;
  let report = newReport();
  try {
    const command = argv.shift();
    if (!['generate', 'verify'].includes(command)) throw new IntegrityError('USAGE');
    const flags = new Map(), related = [];
    const boolean = new Set(['--json','--record-only']);
    const valueFlags = new Set(['--record','--integrity','--markdown','--expected-digest','--receipt-record','--related-record','--max-bytes','--max-nodes','--max-output-bytes']);
    while (argv.length) {
      const key = argv.shift();
      if ((!boolean.has(key) && !valueFlags.has(key)) || (flags.has(key) && key !== '--related-record')) throw new IntegrityError('USAGE');
      let value = true;
      if (valueFlags.has(key)) {
        if (!argv.length || argv[0].startsWith('--')) throw new IntegrityError('USAGE');
        value = argv.shift();
      }
      if (key === '--related-record') related.push(value); else flags.set(key, value);
    }
    const recordOnly = flags.has('--record-only');
    if (recordOnly && flags.has('--markdown')) throw new IntegrityError('USAGE');
    if (command === 'generate' && (recordOnly || flags.has('--expected-digest') || flags.has('--receipt-record') || related.length)) throw new IntegrityError('USAGE');
    if (flags.has('--expected-digest') && (!/^[0-9a-f]{64}$/.test(flags.get('--expected-digest')) || flags.get('--expected-digest').length !== 64)) throw new IntegrityError('EXPECTED_DIGEST_INVALID');
    const options = {};
    for (const [flag, key] of [['--max-bytes','maxBytes'],['--max-nodes','maxNodes'],['--max-output-bytes','maxOutputBytes']]) {
      if (flags.has(flag)) {
        if (!/^[1-9][0-9]*$/.test(flags.get(flag))) throw new IntegrityError('INVALID_LIMIT');
        options[key] = Number(flags.get(flag));
      }
    }
    const limits = limitsFor(options);
    if (!flags.has('--record') || !flags.has('--integrity') || (!recordOnly && !flags.has('--markdown'))) throw new IntegrityError('COMPANION_ARGUMENT_MISSING', 3);
    if (related.length > 32) throw new IntegrityError('RELATED_LIMIT');
    const recordPath = flags.get('--record'), integrityPath = flags.get('--integrity'), markdownPath = flags.get('--markdown');
    if (command === 'generate') {
      const recordBytes = await readCaptured(recordPath, limits.maxBytes);
      const artifacts = generateArtifacts({ recordBytes, limits });
      report = artifacts.report;
      if (report.exit_code === 0) {
        const outputs = await writeCompanions({ recordPath, integrityPath, markdownPath, ...artifacts });
        report.checks.output = { status: 'pass' }; setReportValue(report, 'outputs', outputs);
      }
    } else {
      // Acquire each input once. Collect independent I/O failures so precedence
      // does not depend on which command-line path happens to appear first.
      const failures = [];
      const capture = async (path, budget, check, association = {}) => {
        try { return await readCaptured(path, budget); }
        catch (e) { failures.push([check, { ...failedCheck(e), ...association }]); return undefined; }
      };
      const recordBytes = await capture(recordPath, limits.maxBytes, 'record_input');
      const integrityBytes = await capture(integrityPath, limits.maxBytes, 'metadata_input');
      const markdownBytes = recordOnly ? undefined : await capture(markdownPath, limits.maxOutputBytes, 'markdown_match');
      const receiptBytes = flags.has('--receipt-record') ? await capture(flags.get('--receipt-record'), limits.maxBytes, 'relationships', { input: 'receipt-reference', index: 0 }) : undefined;
      const relatedRecords = [], relatedIndices = [];
      for (const [index, path] of related.entries()) {
        const bytes = await capture(path, limits.maxBytes, 'relationships', { input: 'related-record', index });
        if (bytes) { relatedRecords.push(bytes); relatedIndices.push(index); }
      }
      report = verifyArtifacts({ recordBytes, integrityBytes, markdownBytes, recordOnly, expectedDigest: flags.get('--expected-digest'), receiptBytes, relatedRecords, limits });
      // The byte API indexes its captured array. Restore CLI argument positions
      // using the bounded acquisition map, without inventing missing byte inputs.
      for (const cause of report.checks.relationships.causes || []) {
        if (cause.input === 'related-record') cause.index = relatedIndices[cause.index];
      }
      const replaced = new Set();
      for (const [check, capturedFailure] of failures) {
        const detail = copyReportDetail(capturedFailure, report);
        const failure = { ...detail.value, status: capturedFailure.status,
          code: capturedFailure.code, exit_code: capturedFailure.exit_code,
          ...(detail.truncated ? { details_truncated: true } : {}) };
        // Replace the API's synthetic missing-input result with the actual
        // acquisition failure. Keep additional failures for the same check.
        if (check === 'relationships' && report.checks[check].exit_code) {
          // This result describes other, captured inputs, not a synthetic
          // missing artifact. An acquisition failure must not erase its causes.
          report.checks[check + '_io_' + Object.keys(report.checks).length] = failure;
        }
        else if (!replaced.has(check)) { report.checks[check] = failure; replaced.add(check); }
        else report.checks[check + '_io_' + Object.keys(report.checks).length] = failure;
      }
    }
  } catch (e) { report.checks.operation = failedCheck(e, report); }
  return finish(report);
}

let report;
try { report = await run(process.argv.slice(2)); }
catch { report = { report_version: '0.1', result: 'incomplete', exit_code: 4, code: 'TOOL_STARTUP_FAILURE', assurance: { historical_existence: 'not_established', authorship: 'not_established', currentness: 'not_established', history_completeness: 'not_established' } }; }
// Before modules load, report contains only the fixed startup failure above.
const output = encodeReport ? encodeReport(report) : { text: JSON.stringify(report) + '\n', exitCode: report.exit_code };
process.stdout.write(output.text);
process.exitCode = output.exitCode;
