import { IntegrityError } from '../integrity/errors.js';

const own = (o, k) => Object.hasOwn(o, k);
const punctuation = c => (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
const visible = c => c < 32 || (c >= 127 && c <= 159) || c === 0x61c ||
  (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) ||
  (c >= 0x2060 && c <= 0x2069) || c === 0xfeff;

function literal(value, append) {
  const lines = value.split('\n');
  append('> ');
  for (let i = 0; i < lines.length; i++) {
    if (i) append('\\\n> ');
    const line = lines[i];
    if (!line) { append('&#32;'); continue; }
    const leading = line.match(/^ */)[0].length;
    // Scan the suffix once; a regex can retry long interior space runs.
    let lastNonSpace = line.length;
    while (lastNonSpace > 0 && line.charCodeAt(lastNonSpace - 1) === 32) lastNonSpace--;
    let position = 0;
    for (const character of line) {
      const cp = character.codePointAt(0);
      if (cp === 32 && (position < leading || position >= lastNonSpace)) append('&#32;');
      else {
        let display = character;
        if (character === '\\') display = '\\\\';
        else if (character === '\r') display = '\\r';
        else if (character === '\t') display = '\\t';
        else if (visible(cp)) display = '\\u{' + cp.toString(16).padStart(6, '0') + '}';
        for (const ch of display) append((punctuation(ch.codePointAt(0)) ? '\\' : '') + ch);
      }
      position += character.length;
    }
  }
  append('\n\n');
}

// Internal: input has already passed strict ingestion and record validation.
export function renderProfile(record, maxOutputBytes) {
  const parts = [];
  let size = 0, chunk = '';
  const append = text => {
    size += Buffer.byteLength(text, 'utf8');
    if (size > maxOutputBytes + 1) throw new IntegrityError('RESOURCE_MARKDOWN_BYTES');
    chunk += text;
    if (chunk.length >= 4096) { parts.push(chunk); chunk = ''; }
  };
  const heading = text => append('## ' + text + '\n\n');
  const field = (label, value) => {
    append('**' + label + ':**\n\n');
    if (value === undefined) append('_Not supplied._\n\n');
    else if (value === null) append('null\n\n');
    else if (typeof value === 'string') literal(value, append);
    else append(JSON.stringify(value) + '\n\n');
  };
  const strings = (label, values) => {
    heading(label);
    if (values === undefined) append('_Not supplied._\n\n');
    else if (!values.length) append('_None listed._\n\n');
    else values.forEach((v, i) => field('Item ' + (i + 1), v));
  };
  append('# Basisline ' + (record.record_type === 'receipt' ? 'Decision Receipt' : 'Outcome Record') + '\n\nRenderer profile: 0.1\n\n');
  field('Basisline version', record.basisline_version);
  field('Record type', record.record_type);
  if (record.record_type === 'receipt') {
    field('Receipt ID', record.receipt_id);
    heading('Decision');
    for (const [key, label] of [['summary','Summary'],['context','Context'],['owner','Owner'],['date','Date'],['confidence','Confidence']]) field(label, record.decision[key]);
    heading('Evidence');
    record.evidence.forEach((e, i) => {
      append('### Evidence ' + (i + 1) + '\n\n');
      for (const [key, label] of [['source','Source'],['metric','Metric'],['value','Value'],['unit','Unit'],['freshness_days','Freshness days']]) field(label, e[key]);
    });
    field('Evidence as of', record.evidence_as_of);
    strings('Assumptions', record.assumptions);
    strings('Known conflicts', record.known_conflicts);
    field('Review after days', record.review_after_days);
    heading('Revision');
    if (!own(record, 'revision')) append('_Not supplied._\n\n');
    else {
      field('Supersedes', record.revision.supersedes);
      strings('Related receipt IDs', record.revision.related_receipt_ids);
    }
  } else {
    field('Outcome ID', record.outcome_id);
    field('Receipt ID', record.receipt_id);
    field('Recorded on', record.recorded_on);
    field('Actual result', record.actual_result);
    field('Learning', record.learning);
  }
  // Every template section ends with two LF; remove only the last one.
  parts.push(chunk);
  return Buffer.from(parts.join('').slice(0, -1), 'utf8');
}
