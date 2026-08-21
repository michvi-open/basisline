# Basisline

**An open specification for preserving the evidence, assumptions, and outcomes behind important business decisions.**

No account. No proprietary database. No vendor lock-in.

> Basisline does not tell you what decision to make. It preserves what made the decision reasonable at the time.

**Preserve the basis of the decision.**

---

📄 **[Read the full v0.1 specification →](spec/v0.1.md)**

## Repository Structure

```
spec/            — the specification itself (versioned)
schema/          — JSON Schema files for validation
examples/        — sample receipt/outcome pairs
renderer/        — record → Markdown rendering logic
reference-app/   — the minimal local form + generator
tests/           — schema and renderer tests
CONTRIBUTING.md
LICENSE
SPEC-LICENSE
```

## Status

**Draft v0.1 — specification frozen for reference implementation testing. Breaking changes may occur before v1.0.**

## Attribution

Basisline was initiated as an open specification by Shikhar Jha. The specification is vendor-neutral and may be implemented independently.

*Developed with support from Michvi LLP.*
