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

The current renderer interpolates record strings directly into Markdown. A value
containing headings, links, HTML, or comments can introduce misleading sections
or affect how later content is displayed. Some viewers may also load external
resources. Schema validation does not make this output safe to render.

The app previews Markdown as text using `textContent`. Treat exported Markdown
from untrusted records as untrusted input to any Markdown viewer. It is not a
canonical representation or a security boundary.

Gate 2 must decide whether fields are literal text or permitted Markdown, and
specify multiline handling and escaping across rendering contexts. Gate 1 leaves
the renderer unchanged rather than introducing a partial escaping contract.
