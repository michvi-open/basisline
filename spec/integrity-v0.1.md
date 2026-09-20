# Basisline Integrity v0.1

This optional companion specification leaves the Basisline v0.1 receipt and
outcome schemas unchanged. The authoritative record is JSON. Markdown is a
deterministic human-readable projection, not a canonical cryptographic record.
The browser app continues to use its legacy renderer; it does not generate these
companions. This profile applies to raw bytes, not arbitrary JavaScript objects.

## Processing boundary

1. Capture bounded bytes for each input.
2. Decode UTF-8 fatally. Reject a leading UTF-8 BOM in JSON inputs.
3. Strictly parse one JSON value. Reject malformed syntax, comments, trailing
   commas/junk, and duplicate decoded object member names at every depth.
4. Reject unpaired surrogates and Unicode noncharacters (U+FDD0–U+FDEF and code
   points ending FFFE/FFFF). Preserve other code points without normalization,
   trimming, case folding, or confusable substitution.
5. Apply the numeric profile below to every raw numeric token before conversion
   loses information; validate the unchanged Basisline record schema.
6. Compute `canonical_bytes = UTF8(RFC8785(record))`, without BOM or added newline.
7. Compute `digest = lowercase_hex(SHA256(canonical_bytes))`.
8. Render the same validated record using
   [Markdown Renderer Profile 0.1](markdown-renderer-profile-0.1.md).

The implementation uses the locked jsonc-parser scanner before its visitor.
Scanning checks numeric spans, Unicode, depth, and token budget. The visitor
rejects duplicate decoded names before assignment, so `a` and `\u0061` collide.
Objects have null prototypes and own members; completed containers are frozen.
Numeric-token locations retain bounded-depth path segments sharing ancestor
names, rather than a full JSON Pointer per number. Pointers are serialized only
for reported diagnostics (at most 20) and schema-integer errors. Long ancestor
names therefore do not multiply allocation by the number of numeric descendants.
Parser error recovery is disabled by throwing on every reported error.
The JCS library is behind an adapter that receives only these owned trees.

Object-member order, JSON whitespace, equivalent escapes, and accepted equivalent
numeric spellings do not affect fingerprints. Array order and Unicode code-point
differences do. Confusable strings remain distinct but may look identical.

## Numeric acceptance profile

For every JSON numeric token, define M as its exact decimal mathematical value,
x as its correctly rounded IEEE-754 binary64 conversion, X as the exact value of
x's bits, c as its RFC 8785 numeric spelling, and K as c's exact decimal value.

All of these conditions MUST hold:

- The complete token has JSON numeric grammar.
- x is finite.
- If M is nonzero, X is nonzero.
- If M is mathematically integral, M = X = K.
- If K is mathematically integral, K = X.
- Schema-integer fields additionally require M to be integral, and retain all
  existing schema constraints. In v0.1 these fields are `review_after_days` and
  `evidence[].freshness_days`.

This is an Integrity input profile, not a new restriction on the base record
schemas and not a claim that JCS itself prohibits all other inputs. There is no
blanket safe-integer cutoff, unit-based precision rule, or number-to-string
conversion. Ordinary decimals such as 71.2 and 0.4 are supported. Nonintegral
decimals follow the JCS binary64 model and can round, including to an integer;
`DECIMAL_ROUNDING` diagnostics identify source/canonical decimal differences
(up to the diagnostic limit). Exact nonintegral decimal arithmetic is not
provided. Negative zero becomes zero.

Examples: 9007199254740991, 9007199254740992, 9007199254740994, 1e20, 1e21, and
1e22 pass. 9007199254740993, 1e23, 295147905179352825856, and its JCS spelling
295147905179352830000 do not. 1e400 and nonzero 1e-400 do not. A fraction such as
1.0000000000000001 can become 1 in `evidence[].value`, but is refused in an
integer-declared field because M is fractional.

Closure: re-ingesting c gives the same x and c. If K is integral, the fifth rule
ensures the re-ingested integer equals X and K; otherwise no integer equality
condition is introduced. Finite nonzero x cannot have a zero round-trip spelling.
Integral schema fields stay integral. Therefore every accepted record's JCS
representation satisfies this numeric profile. The implementation also requires
canonical bytes to fit the same byte budget. This does not imply lexical source
preservation, or that all mathematical integers representable by binary64 pass.

## Metadata schema and binding

[integrity-metadata.schema.json](../schema/integrity-metadata.schema.json) defines
exactly seven required fields, with no additional properties:

```json
{
  "basisline_integrity_version": "0.1",
  "record_id": "bl_2026-09-19_a1",
  "record_type": "receipt",
  "canonicalization": "RFC8785",
  "hash_algorithm": "SHA-256",
  "digest_encoding": "hex-lower",
  "digest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

The digest above illustrates shape only. `record_type` is `receipt` or `outcome`.
It MUST equal the record's type. `record_id` MUST equal `receipt_id` for a receipt,
or `outcome_id` for an outcome. The digest is exactly 64 lowercase hexadecimal
characters. Unknown versions, algorithms, canonicalization profiles, and encodings
fail closed. Missing fields and unknown extra fields fail schema validation.
The sidecar itself uses strict JSON ingestion. Its serialization is not hashed.

Integrity version 0.1 normatively selects Renderer Profile 0.1. There is no
`renderer_profile` sidecar field, profile auto-detection, or legacy fallback.
Unsupported metadata cannot select a Markdown comparison. Changing these rules
requires a new Integrity version; base record version 0.1 remains frozen.

## Dates and incomplete validation

Existing Gate-1 syntax/calendar/component checks are reused. Otherwise plausible
year-0000 dates and leap-second notation remain unresolved compatibility cases.
They are not declared invalid by a new Basisline temporal policy. Generation
produces no companions. Verification reports `result: "incomplete"`,
`record_schema.status: "unresolved"`, code `SCHEMA_FORMAT_UNRESOLVED`, and exit 2;
dependent fingerprint and Markdown checks are skipped. Independent failures can
raise the overall exit according to precedence below. Definite schema errors
remain errors even when another field is unresolved. This is not a claim of
complete RFC 3339 occurrence validation.

## CLI and byte API

Use Node.js 22 or later. Install the lockfile using `npm ci --ignore-scripts`.
The filesystem CLI supports Linux and macOS. No network access is needed to run it.

```text
node integrity/cli.js generate --record FILE --integrity NEW_FILE --markdown NEW_FILE
node integrity/cli.js verify --record FILE --integrity FILE --markdown FILE
node integrity/cli.js verify --record FILE --integrity FILE --record-only
```

`--json` is accepted; all modes already emit exactly one JSON report and one LF
on stdout. Use the direct Node invocation when stdout must be machine-readable;
the npm script runner can emit its own banners. Errors contain stable codes, not
raw stack traces. JSON/control/format escaping prevents direct terminal escape
injection in reports. Caller termination or a broken stdout pipe cannot guarantee
a complete report.

Verify options: `--expected-digest HEX`, `--receipt-record FILE`, and repeatable
`--related-record FILE` (at most 32). No companion discovery occurs. All path
arguments are explicit; record content is never used to construct a path. Use
`./` before a pathname beginning `--`. `--record-only` excludes Markdown from
the requested scope and cannot be combined with `--markdown`.

Byte APIs: `generateArtifacts({recordBytes, limits})` returns `{report}` and,
only on success, `integrityBytes` and `markdownBytes`. `verifyArtifacts` accepts
`recordBytes`, `integrityBytes`, `markdownBytes`, optional boolean `recordOnly`,
`expectedDigest`, `receiptBytes`, `relatedRecords` (an array of byte buffers), and
`limits`. Inputs must be unshared Uint8Array/Buffer bytes and are copied. Internal
parser, canonicalizer, and renderer exports are not arbitrary-object APIs.

## Reports and exit codes

Checks: `record_input`, `metadata_input`, `record_schema`, `numeric_profile`,
`metadata_schema`, `record_binding`, `canonicalization`, `fingerprint_match`,
`markdown_match`, `expected_digest`, and `relationships`. Generation additionally
reports filesystem output success/failure. Statuses are `pass`, `fail`,
`unsupported`, `unresolved`, `not_requested`, or `skipped`. An input/profile/resource
refusal uses `unsupported`; it is not necessarily a base-schema violation.
Failed checks carry `code` and `exit_code`; successful checks never substitute
for a skipped required check. Raw-token refusals occur at `record_input` before
the subsequent schema-integer `numeric_profile` check.

The aggregate result is `checks_passed`, `checks_failed`, or `incomplete`.
Reports identify scope, target versions, checks, diagnostics, and, when available,
`record_id` and `computed_digest`. They do not contain a generic `verified` flag.

| Exit | Meaning |
|---|---|
| 0 | Every required check in the requested scope completed and passed |
| 1 | Supported schema/binding/fingerprint/Markdown/expected-digest mismatch |
| 2 | Invalid invocation, malformed or unsupported input/profile, unresolved compatibility, resource refusal |
| 3 | Required artifact or companion argument missing |
| 4 | I/O, crypto, or internal failure, including output collision |

Invocation is checked before I/O. Thereafter precedence is 4 > 3 > 2 > 1 > 0,
independent of check insertion order. Failed acquisition replaces any synthetic
missing-input result. Multiple independent acquisition failures are retained.

Every report, including startup failure, retains these assurance entries:

```json
{
  "historical_existence": "not_established",
  "authorship": "not_established",
  "currentness": "not_established",
  "history_completeness": "not_established"
}
```

Optional relationship checks compare supplied record IDs and fingerprints only.
Same ID with different digests fails with `SAME_ID_DIFFERENT_DIGEST`. Forks,
cycles, and absent referenced receipts are diagnostic observations, not proof of
complete history or a selected current revision. `--receipt-record` explicitly
requires an outcome and a receipt with matching receipt IDs. These record links
do not bind a receipt digest. Outcomes remain separately fingerprinted; adding
an outcome does not change the original receipt's digest.

All bounded independent related inputs, including the explicit receipt reference,
are classified before reducing failures with the exit precedence above. Failed
input checks remain in `checks.relationships.causes`, with their input kind,
zero-based input index, check, status, code, exit code, and any diagnostic details.
In CLI reports, related-record indices refer to the original `--related-record`
argument order, including arguments whose acquisition failed. The single explicit
receipt uses input kind `receipt-reference` and index 0. Related/receipt acquisition
failures carry the same input kind and original index. Byte API indices continue
to refer to the supplied `relatedRecords` array.
Available receipt-binding and same-ID/different-digest failures remain as causes
even when another input is unresolved. Causes are bounded by the input/check
limits, separately from the 20-observation diagnostic budget. A resolved revision
target of type outcome produces the nonfatal `REVISION_TARGET_TYPE_MISMATCH`
diagnostic and is not traversed as a superseded receipt.

## Filesystem and resource boundary

Inputs are opened once with O_NOFOLLOW and O_NONBLOCK, then checked as regular
files through the descriptor. An initial lstat provides early refusal; it is not
the security check for the later open. Reads are bounded, and changed descriptor
size/mtime/ctime cause refusal. Verification uses captured bytes after acquisition.
This is not a transactional snapshot, and undetectable concurrent in-place writes
remain outside the guarantee. Parent directories, mount behavior, runtime, and OS
must be trusted; intermediate symlinks are not prohibited. Lexical path resolution
is not a filesystem sandbox. No path is taken from record data.

Generation leaves source JSON untouched. It reserves both outputs using exclusive
creation (mode 0600), writes/syncs Markdown first and metadata last, then closes.
Existing files, final symlinks, and path collisions are refused. There is no rename,
manifest, package directory protocol, or multi-file atomicity. Failure or a crash
can leave empty or partial outputs; the error lists created paths when possible.
No pathname cleanup is attempted because another actor may have replaced it.
Do not treat a sidecar's existence as a commit marker. Verify the captured triplet.
Directory entries are not fsynced, and power-loss durability is not promised.

Defaults: JSON input/canonical bytes 1 MiB; 100,000 non-whitespace lexical tokens
(including punctuation); rendered/supplied Markdown 16 MiB. CLI options
`--max-bytes`, `--max-nodes`, and `--max-output-bytes` map to API `maxBytes`,
`maxNodes`, and `maxOutputBytes`. Positive integer overrides are capped at 64 MiB
or 67,108,864 tokens. They are operational limits, not base-schema restrictions.
Record nesting is capped at three containers and sidecar nesting at one, sufficient
for these frozen schemas. Array/object/string allocation is bounded by the byte
and token budgets. Up to 20 diagnostics are emitted; their absence is not proof
that no further observations exist. Related-record inputs multiply the input-byte
budget; callers should not raise limits indiscriminately in constrained services.

The ten repository examples are at most 1,198 bytes, depth three, 39 JSON values,
and 171 UTF-16 code units per string. The defaults leave substantial headroom;
they are not justified as universal business-record maxima or as a CPU deadline.
The parser/library still allocates bounded decoded strings before all later checks.
Local resource refusal is distinguished from protocol invalidity.

## Guarantees and non-guarantees

A successful fingerprint check establishes correspondence of supplied JSON's
accepted JCS representation with its supplied SHA-256 digest, subject to SHA-256's
collision resistance and the trusted implementation. A successful Markdown check
establishes exact bytes equal the selected deterministic projection. A supplied
expected digest gives another explicit comparison point, without establishing
where that value came from. Subsequent-modification detection is relative to a
retained fingerprint and does not detect changes erased by canonicalization.

None establishes evidence truth, authenticated identity, historical existence,
immutability, authorship, provenance, confidentiality, complete supplied history,
absence of omitted records, or currentness. Replacing JSON, sidecar, and Markdown
together can pass. Replaying an old valid triplet or presenting different
self-consistent histories separately can pass. Compromised producers/verifiers,
dependencies, runtimes, and operating systems are outside this boundary.
Append-only remains a specification/workflow requirement. No signatures,
timestamp authorities, identity services, or external anchoring are implemented.

Standards and dependency/vector sources are listed in
[INTEGRITY-SOURCES.md](../tests/fixtures/INTEGRITY-SOURCES.md).
