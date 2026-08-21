# Contributing to Basisline

Basisline v0.1 is frozen. Contributions to the reference implementation
(schema validation, renderer, reference app, tests) are welcome. Changes to
the specification itself require a clear rationale — open an issue first.

## Out of scope for this repository (v0.1)

Per the frozen specification's non-goals, the following are **not** accepted
as pull requests against this repository. If you'd like to build one of
these on top of Basisline, please do so as a separate, independent project:

- Cryptographic signing / hashing of records
- A plugin system
- An API or hosted service
- A database backend
- Authentication / accounts
- SaaS features of any kind

## How to contribute

1. Open an issue describing the change before submitting a PR.
2. Keep changes scoped — one schema fix, one renderer bug, one test, per PR.
3. Reference implementation changes must not introduce a contradiction with
   `spec/v0.1.md`. If you find one, open a spec issue instead of a code PR.
