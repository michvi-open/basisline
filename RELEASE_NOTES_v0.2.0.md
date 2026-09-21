# Basisline v0.2.0

Basisline v0.2.0 adds an optional integrity layer for Basisline records and strengthens validation and reference-app behavior while retaining the Basisline v0.1 record model.

## Basisline Integrity v0.1

This release introduces Basisline Integrity v0.1, an optional companion profile for locally checking the correspondence between a Basisline record and its integrity artifacts.

It includes:

- strict byte-oriented JSON ingestion
- duplicate-member and malformed-input rejection
- bounded UTF-8, Unicode, numeric, depth, node, and file processing
- RFC 8785 (JCS) canonicalization
- a defined numeric input profile for deterministic canonicalization
- SHA-256 fingerprints over canonical record bytes
- detached integrity metadata bound to record ID and record type
- deterministic Markdown Renderer Profile 0.1
- exact Markdown artifact comparison
- receipt, outcome, and revision relationship diagnostics
- machine-readable CLI generation and verification reports
- explicit exit-code precedence
- filesystem protections including symlink and overwrite refusal
- bounded diagnostic/report construction and bounded CLI JSON report serialization
- defensive bounded file reads, including short-read, growth, and metadata-inconsistency handling

The Integrity profile does not modify the authoritative Basisline JSON record. JSON remains authoritative; Markdown is derived.

## Validation and reference-app hardening

The release also strengthens the existing Basisline v0.1 implementation and reference app, including:

- stricter date and date-time validation
- preservation and validation of partial evidence input
- rejection of non-finite numeric values
- stricter integer-field handling
- timezone-aware browser date-time conversion
- explicit handling of invalid local times
- schema-copy consistency checks
- additional integration and regression coverage

## Conformance and regression coverage

The test suite now includes coverage for:

- RFC 8785 canonicalization vectors
- binary64 and numeric-boundary behavior
- duplicate decoded JSON member names
- malformed JSON and invalid UTF-8
- Unicode surrogate and noncharacter handling
- integrity metadata binding and profile selectors
- exact Markdown byte comparison
- Markdown structural-injection resistance
- resource limits
- filesystem and output-collision behavior
- relationship diagnostics
- deterministic exit precedence
- timezone and date/date-time edge cases

## Assurance boundary

A successful Basisline Integrity check establishes correspondence between the supplied record, its accepted canonical representation, its supplied fingerprint, and—when requested—its deterministic Markdown representation.

It does not by itself establish:

- authorship
- historical existence
- currentness
- provenance or truth of evidence
- completeness of history
- immutability
- non-repudiation

A self-consistent record and its companion artifacts can be replaced together and still pass local verification. External trust or anchoring is outside the scope of Basisline Integrity v0.1.

## Compatibility

Basisline v0.2.0 retains the Basisline v0.1 record specification and schemas. Basisline Integrity v0.1 is additive and optional.

Node.js 22 or later is required for the JavaScript tooling.
