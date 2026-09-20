import { createScanner, visit, SyntaxKind as S } from 'jsonc-parser';
import { inspectNumber } from './numbers.js';
import { IntegrityError, limitsFor, snapshot } from './errors.js';

export function checkUnicode(value) {
  if (!value.isWellFormed()) throw new IntegrityError('UNICODE_SURROGATE');
  for (const character of value) {
    const cp = character.codePointAt(0);
    if ((cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xffff) >= 0xfffe) {
      throw new IntegrityError('UNICODE_NONCHARACTER');
    }
  }
}

export const pointer = (path) => path.length ? '/' + path.map(p => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '';

export function ingest(bytes, options = {}, maxDepth = 3) {
  const limits = limitsFor(options);
  const captured = snapshot(bytes, limits.maxBytes);
  if (captured[0] === 0xef && captured[1] === 0xbb && captured[2] === 0xbf) throw new IntegrityError('JSON_BOM');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(captured); }
  catch { throw new IntegrityError('UTF8_INVALID'); }
  const scanner = createScanner(text, false);
  const numericOffsets = new Map();
  let depth = 0, nodes = 0;
  for (let token = scanner.scan(); token !== S.EOF; token = scanner.scan()) {
    const offset = scanner.getTokenOffset();
    if (scanner.getTokenError()) throw new IntegrityError('JSON_SYNTAX', 2, { offset });
    if ([S.Unknown, S.LineCommentTrivia, S.BlockCommentTrivia].includes(token)) throw new IntegrityError('JSON_SYNTAX', 2, { offset });
    if (token === S.OpenBraceToken || token === S.OpenBracketToken) {
      if (++depth > maxDepth) throw new IntegrityError('RESOURCE_DEPTH');
    }
    if (token === S.CloseBraceToken || token === S.CloseBracketToken) depth--;
    if (![S.Trivia, S.LineBreakTrivia].includes(token) && ++nodes > limits.maxNodes) throw new IntegrityError('RESOURCE_NODES');
    if (token === S.StringLiteral) checkUnicode(scanner.getTokenValue());
    if (token === S.NumericLiteral) numericOffsets.set(offset, inspectNumber(text.slice(offset, offset + scanner.getTokenLength())));
  }
  const stack = [], numbers = new Map();
  let root;
  function attach(value) {
    const frame = stack.at(-1);
    if (!frame) root = value;
    else if (Array.isArray(frame.value)) frame.value.push(value);
    else Object.defineProperty(frame.value, frame.key, { value, enumerable: true, writable: true, configurable: true });
  }
  function begin(value) {
    attach(value);
    stack.push({ value, names: new Set(), key: null });
  }
  visit(text, {
    onObjectBegin() { begin(Object.create(null)); },
    onArrayBegin() { begin([]); },
    onObjectProperty(name, offset) {
      const frame = stack.at(-1);
      if (frame.names.has(name)) throw new IntegrityError('DUPLICATE_MEMBER', 2, { offset });
      frame.names.add(name);
      frame.key = name;
    },
    onObjectEnd() { Object.freeze(stack.pop().value); },
    onArrayEnd() { Object.freeze(stack.pop().value); },
    onLiteralValue(value, offset, length, line, column, path) {
      if (typeof value === 'number') {
        const info = numericOffsets.get(offset);
        if (!info || !Object.is(info.value, value)) throw new IntegrityError('PARSER_NUMBER_DISAGREEMENT', 4);
        numbers.set(pointer(path()), info);
      }
      attach(value);
    },
    onError(error, offset) { throw new IntegrityError('JSON_SYNTAX', 2, { offset }); },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  return { value: root, numbers, captured, limits };
}
