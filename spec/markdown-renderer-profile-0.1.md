# Markdown Renderer Profile 0.1

Integrity version 0.1 selects this profile. It is distinct from the unchanged
legacy browser renderer. The JSON record remains authoritative and is not mutated
for display. This is a deterministic human-readable projection, not the canonical
cryptographic representation. The structural-safety target is CommonMark 0.31.2.
Extensions that reinterpret literal text are outside that target.

## Encoding and template primitives

Output is UTF-8, without BOM, with LF physical line endings and exactly one final
LF. There is no locale, timezone, currency, or unit formatting. Numbers use the
RFC 8785/ECMAScript scalar number spelling, including zero for negative zero.
Original numeric token spellings are not displayed. Array order is preserved.

The exact primitives below define the template. `LF` denotes byte 0A. Every field
label and heading is fixed ASCII except renderer-owned decimal item indices.
Concatenate primitives, then remove exactly the final LF (every primitive ends
with two). There are no trailing spaces except those explicitly part of the
literal encoder's syntax.

- Title: `# Basisline Decision Receipt` or `# Basisline Outcome Record`, two LF,
  `Renderer profile: 0.1`, two LF.
- Section: `## ` + fixed label + two LF.
- Evidence heading: `### Evidence ` + one-based decimal index + two LF.
- Field: `**` + fixed label + `:**` + two LF, followed by one encoded value
  defined below. The encoded value owns its two-LF terminator; field composition
  adds no terminator after it.
- Absent optional value/section: `_Not supplied._` + two LF.
- Present empty string array: `_None listed._` + two LF.
- Null value: literal `null` + two LF.
- Number value: its locale-independent scalar spelling + two LF, without a code span.
- String value: the literal encoder below (which includes its final two LF).
- String array section: section heading, then fields labelled `Item 1`, `Item 2`,
  etc.; absent/empty markers replace the fields where appropriate.

These exact interior transitions illustrate separator ownership. In the following
notation, each `\n` denotes one LF byte, not a literal backslash and letter `n`:

```text
**Summary:**\n\n> Ship\n\n**Context:**
**Value:**\n\n71.2\n\n**Unit:**
**Supersedes:**\n\nnull\n\n## Related receipt IDs
**Supersedes:**\n\n_Not supplied._\n\n## Related receipt IDs
```

The last example has a present revision object with its `supersedes` member
omitted. In every example the encoded value contributes exactly two LF before
the next field or heading. Only the end-of-document rule removes one final LF.

## One literal encoder for every string

1. Split the decoded string on U+000A only, preserving empty and final empty
   segments. Each segment is a renderer-owned blockquote line prefixed `> `.
2. Between segments emit backslash, LF, then `> `. The backslash is an owned
   CommonMark hard line break. Never emit an unprefixed user-content line.
3. An empty segment becomes `&#32;`. Every leading/trailing U+0020 in a nonempty
   segment becomes `&#32;`, including all spaces of an all-space segment. Interior
   spaces remain ordinary spaces. Other whitespace is not silently trimmed.
4. Convert an original backslash to two visible backslashes, CR to visible `\r`,
   TAB to visible `\t`, and the code points below to visible `\u{hhhhhh}` (six
   lowercase hexadecimal digits). These are display encodings, not newlines:
   U+0000–U+001F except the already-split LF and separately encoded CR/TAB;
   U+007F–U+009F; U+061C; U+200B–U+200F; U+2028–U+202E; U+2060–U+2069; U+FEFF.
5. Escape **every ASCII punctuation character** in the resulting display text
   by prefixing a backslash: U+0021–U+002F, U+003A–U+0040, U+005B–U+0060,
   U+007B–U+007E. This includes encoder-created visible backslashes and braces.
   The owned `&#32;` entities and hard-break syntax bypass this punctuation step.
6. Append two LF after the last segment.

All other valid Unicode is preserved without normalization. Consequently this
is not a confusable-detection system. Visually identical strings can remain
different records. The visible encoding distinguishes an original control from
a literal backslash spelling of that control. The empty-line marker is for
display; the projection is not intended as an independently reversible record.

HTML brackets, comments, Markdown punctuation, links/images, reference-link
definitions, lists, fences, and thematic breaks supplied in strings become
literal text. Record strings cannot create template headings or escape their
value blockquotes. HTML viewers must implement CommonMark escaping correctly;
extensions, linkifiers, terminal rendering, and HTML post-processing need their
own review. The authoritative JSON remains unchanged.

## Exact field order

Both types begin with the title, then fields `Basisline version` and `Record type`.

Receipts continue with:

1. `Receipt ID` field.
2. `Decision` section: fields `Summary`, `Context`, `Owner`, `Date`, `Confidence`.
3. `Evidence` section: for each entry, evidence heading then fields `Source`,
   `Metric`, `Value`, `Unit`, `Freshness days`.
4. `Evidence as of` field, following the final evidence entry.
5. `Assumptions` string array section.
6. `Known conflicts` string array section (including an absence marker when absent).
7. `Review after days` field.
8. `Revision` section. If absent, one absence marker. If present: `Supersedes`
   field, then `Related receipt IDs` string array section. Missing members use
   their respective absence markers; null supersedes uses `null`.

Outcomes continue with fields `Outcome ID`, `Receipt ID`, `Recorded on`,
`Actual result`, `Learning`, in that order. There is no joined receipt/outcome
projection in this profile. Confidence, dates, timestamps, IDs, and units all use
the same string encoder; they are not title-cased, abbreviated, or reformatted.

## Comparison and tests

Comparison is exact bytes. No BOM stripping, line-ending normalization, trailing
newline tolerance, Markdown parsing equivalence, or whitespace normalization is
permitted during verification. A legacy projection is not this profile.

The independent golden fixtures are
[profile-receipt.md](../tests/fixtures/profile-receipt.md) and
[profile-outcome.md](../tests/fixtures/profile-outcome.md), paired with JSON files
of the same stems. Tests compare bytes, then separately parse adversarial outputs
with commonmark 0.31.2 and check the template's structural nodes and absence of
user-created HTML/link/image/list/code/rule nodes. Locale/timezone tests compare
against the same fixed golden bytes. Test success is evidence for the specified
parser target, not universal viewer safety.
