# Security Policy

## Supported Versions

Basisline is currently pre-1.0. Security fixes are applied to the latest published release and the default branch where appropriate.

## Reporting a Vulnerability

Please do not open a public issue for a suspected security vulnerability.

Report security concerns privately through GitHub's private vulnerability reporting feature, if enabled for this repository.

If private vulnerability reporting is unavailable, contact the repository maintainers directly through the organisation contact channels.

Please include:
- a clear description of the issue
- affected files or components
- reproduction steps where applicable
- potential impact
- any suggested mitigation

We will acknowledge valid reports and assess them before public disclosure.

## Scope

This policy covers the Basisline specification, schemas, renderer, reference application, and repository tooling.

The reference application is intentionally minimal and browser-based. It should not be treated as a hosted production service without an independent security review appropriate to the deployment environment.

Records are append-only by specification. Files remain editable; the application
does not enforce or verify their creation time, modification history, or truth.

## Markdown output

The legacy browser renderer interpolates record strings directly into Markdown. A value
containing headings, links, HTML, or comments can introduce misleading sections
or affect how later content is displayed. Some viewers may also load external
resources. Schema validation does not make this output safe to render.

The app previews Markdown as text using `textContent`. Treat exported Markdown
from untrusted records as untrusted input to any Markdown viewer. It is not a
canonical representation or a security boundary.

The optional Integrity CLI uses the separate
[Markdown Renderer Profile 0.1](spec/markdown-renderer-profile-0.1.md). It treats
record strings literally within a fixed template, targeting CommonMark 0.31.2.
Its exact-byte comparison does not cover viewer extensions, custom HTML
post-processing, fonts, or visually confusable Unicode characters.

## Integrity boundaries

[Integrity v0.1](spec/integrity-v0.1.md) checks the supplied record against the
supplied fingerprint and, when requested, the supplied Markdown against its
deterministic projection. It establishes neither truthful evidence nor an
authenticated owner, historical existence, currentness, complete history,
confidentiality, or provenance. A whole replacement triplet can pass. Separate
outcomes do not bind a receipt's digest, and matching IDs do not authenticate a
relationship. Independently retained expected digests are comparison inputs;
their origin and trustworthiness are outside this tool.

File operations require trusted parent directories. Captured reads are bounded
and reject final symlinks/special files on supported platforms, but are not
transactional filesystem snapshots. Generation uses exclusive creation without
overwrite and can leave partial companions after failure or a crash. There is
no multi-file atomicity or power-loss durability guarantee. Resource refusals and
unresolved date-format compatibility are reported as incomplete, not proof that
a record violates the Basisline record protocol. A compromised producer,
verifier, runtime, dependency, or operating system is outside this boundary.

Input byte limits are separate from report limits. The Integrity tool bounds
copied diagnostic strings, detail traversal, and accumulated report material
before storage, and caps incremental CLI JSON output at 256 KiB. Truncation is
explicit and does not change the values used for integrity comparisons. See the
[report budgets and markers](spec/integrity-v0.1.md#filesystem-and-resource-boundary).
These controls do not guarantee protection against every denial-of-service attack.
