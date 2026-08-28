# Basisline

**An open specification for preserving the evidence, assumptions, and outcomes behind important business decisions.**

No account. No proprietary database. No vendor lock-in.

> Basisline does not tell you what decision to make. It preserves what made the decision reasonable at the time.

**Preserve the basis of the decision.**

---

📄 **[Read the full v0.1 specification →](spec/v0.1.md)**

## Try it

```bash
cd reference-app
python3 -m http.server 8000
```

Then open **http://localhost:8000**. (Any static file server works — this
just needs to not be opened via `file://`, since the app fetches
`schema/*.json` at runtime. See [reference-app/README.md](reference-app/README.md)
for why.)

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

## Testing

Install the Python test dependency:

```bash
python3 -m pip install -r requirements-dev.txt
```

Then run the complete test suite:

```bash
npm test
```

The v0.1 test suite covers schema validation, deterministic rendering, cross-example smoke tests, and reference-app logic.

## Acknowledgements

Basisline was initiated by Shikhar Jha as an open, vendor-neutral specification.

Special acknowledgement is extended to Ashok Kumar Jha and Vinita Jha for their continued support of the work, and to [Michvi LLP](https://michvi.com) for supporting its development and publication.
