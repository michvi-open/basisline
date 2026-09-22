# Contributing to Basisline

The Basisline v0.1 record specification and receipt/outcome schemas are frozen.
Basisline Integrity v0.1 is an optional companion profile introduced with the
Basisline v0.2.0 repository release. Contributions to the reference implementation
(schema validation, renderer, reference app, tests) are welcome. Changes to
the frozen record specification itself require a clear rationale — open an issue first.

## Out of scope for the Basisline v0.1 record specification

Per the frozen specification's non-goals, the following are **not** accepted
as pull requests against this repository. If you'd like to build one of
these on top of Basisline, please do so as a separate, independent project:

- Cryptographic signing of records
- A plugin system
- An API or hosted service
- A database backend
- Authentication / accounts
- SaaS features of any kind

Optional record fingerprints and their detached companions are covered by
[Integrity v0.1](spec/integrity-v0.1.md). This functionality does not change the
frozen v0.1 receipt/outcome schemas or add signing to the repository's scope.

## How to contribute

1. Open an issue describing the change before submitting a PR.
2. Keep changes scoped — one schema fix, one renderer bug, one test, per PR.
3. Reference implementation changes must not introduce a contradiction with
   `spec/v0.1.md`. If you find one, open a spec issue instead of a code PR.
