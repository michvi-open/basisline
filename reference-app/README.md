# Basisline Reference App (v0.1)

A minimal, local, browser-only tool for creating Decision Receipts and
Outcome Records that conform to the [Basisline v0.1 specification](../spec/v0.1.md).

No build step. No dependencies. No server-side code. No database, auth,
cloud sync, dashboard, AI, or analytics — see the spec's non-goals.

## Running it

Browsers block `fetch()` of local files when a page is opened directly via
`file://`, and this app fetches the schema files at runtime (so the schema
stays the single source of truth instead of being duplicated into the app).
Run a local static server from the repository root so the app can also load
`renderer/render.js`. Do not serve only `reference-app/` or double-click `index.html`:

```bash
# Run from the repository root (the directory containing package.json).
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8000/reference-app/** in your browser.

(Other static servers work when they serve the repository root and bind to
loopback. Nothing here requires Python specifically.)

## How it works

```
form input → buildReceiptObject() / buildOutcomeObject()  (lib/form-mapping.js)
           → validate() against schema/*.json              (lib/validate.js)
           → renderReceiptMarkdown() / renderOutcomeMarkdown()  (../renderer/render.js)
           → download as .json and .md
```

The app does not encode its own validation rules — `lib/validate.js` is a
small generic JSON Schema engine that reads `schema/*.json` at runtime.
If the schema rejects a record, the form shows why. The schema files in
this folder are copies of the canonical ones in `../schema/`; `tests/`
checks they stay in sync.

## Dates and numeric input

The form interprets **Evidence as of** in the browser's local timezone and
exports the corresponding UTC instant. For example, `2026-09-19T19:00` in
UTC+05:30 becomes `2026-09-19T13:30:00.000Z`. Nonexistent local times during
daylight-saving transitions are rejected. If the clock repeats a time, the
browser's `Date` behavior selects the earlier occurrence. Record-building
helpers do not infer a timezone; other producers must supply an explicit offset.

The schemas retain their existing `date` and `date-time` formats; Gate 1 does
not define a narrower Basisline temporal profile. The JavaScript validator
checks syntax, Gregorian calendar components, time components, and numeric
offsets. It does not exclude year `0000` or leap-second notation (`:60`).
Accepting `:60` notation does not establish that a leap second occurred at that
instant: occurrence validation remains unresolved. These checks are not a claim
of complete RFC 3339 conformance.

Python's date/time FormatChecker rejects year `0000` and leap-second notation.
The test runner reports otherwise well-formed records encountering those library
limitations as **UNRESOLVED**, rather than declaring them schema-invalid or fully
validated. Such a result makes the test run incomplete (nonzero exit status).
Regression tests distinguish these library limitations from definite invalid
dates/times; they do not turn the library's supported subset into Basisline policy.

Browser form generation is separate: it uses the browser's positive-year date
input and JavaScript `Date`, which does not generate leap-second notation. UTC
conversion can cross a year boundary; values outside the validator's four-digit
year syntax cannot be exported through the form. Other producers are not required
to use this browser form.

Numeric inputs accept decimal and exponent notation as whole values. Blank,
invalid, and non-finite values are rejected, and integer fields are checked
without truncation. Only completely empty evidence rows are ignored.

The app never silently changes a number you type. Before building a record it
applies the [Integrity numeric profile](../spec/integrity-v0.1.md#numeric-acceptance-profile)
to the exact text entered (`lib/number-input.js`):

- **Blocked, with the reason shown:** values too large or too small for a JSON
  number, whole numbers that binary64 cannot hold exactly (for example
  `9007199254740993`, `1e23`, or `1.5e300`), and fractions in whole-number fields
  (`freshness_days`, `review_after_days`), including ones such as
  `1.0000000000000001` that would round to a whole number.
- **Accepted with a visible warning:** decimals that binary64 rounds, such as
  `0.30000000000000001`, which is stored as `0.3`. The warning shows both values.
  Record exact amounts in a smaller unit where that matters.
- **Accepted silently:** respellings with the same value, such as `1e2` → `100`
  or `1.50` → `1.5`.

Browsers' own number-input validation accepts all of the blocked examples above,
so this check is what prevents silent changes.

Text is checked the same way: unpaired surrogates (usually from a damaged paste)
and Unicode noncharacters such as U+FFFE are refused with the field's path,
because Integrity refuses them (`lib/text-input.js`). The form therefore does not
export numbers or characters that `node integrity/cli.js generate` would refuse.
The CLI's other limits are not checked in the browser: its 1 MiB input budget,
and dates it reports as unresolved (year 0000, a `:60` second).

The renderer currently passes record text through as Markdown. See
[the Markdown limitation](../SECURITY.md#markdown-output) before viewing untrusted
records in a Markdown viewer.
