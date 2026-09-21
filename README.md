# Basisline

**An open specification for preserving the evidence, assumptions, and outcomes behind important business decisions.**

No account. No proprietary database. No vendor lock-in.

> Basisline does not tell you what decision to make. It preserves what made the decision reasonable at the time.

**Preserve the basis of the decision.**

---

📄 **[Read the full v0.1 specification →](spec/v0.1.md)**

## The 30-second version

A decision gets made using evidence available at the time. Later, the numbers,
assumptions, dashboards, people, or context may have changed.

Basisline keeps the decision, its evidence, assumptions, known conflicts, and
review point in a portable record. The outcome can be recorded separately later.
For example: an ad platform reports 690 conversions while the CRM records 61
qualified leads. A budget decision is made anyway. Basisline preserves what was
decided, which evidence was available, and the known conflict at that time.

## Try the integrity check

The repository includes a real decision receipt you can fingerprint and verify.
Change the authoritative JSON after fingerprinting and verification fails.

Requires Node.js 22 or later.

```bash
npm ci --ignore-scripts
tmpdir="$(mktemp -d)"
cp examples/marketing-budget-receipt.json "$tmpdir/receipt.json"

node integrity/cli.js generate --record "$tmpdir/receipt.json" --integrity "$tmpdir/receipt.integrity.json" --markdown "$tmpdir/receipt.md"
node integrity/cli.js verify --record "$tmpdir/receipt.json" --integrity "$tmpdir/receipt.integrity.json" --markdown "$tmpdir/receipt.md" --json

node -e 'const fs=require("fs");const p=process.argv[1];const r=JSON.parse(fs.readFileSync(p,"utf8"));r.decision.summary+=" [changed after fingerprinting]";fs.writeFileSync(p,JSON.stringify(r,null,2)+"\n");' "$tmpdir/receipt.json"

node integrity/cli.js verify --record "$tmpdir/receipt.json" --integrity "$tmpdir/receipt.integrity.json" --markdown "$tmpdir/receipt.md" --json; changed_exit=$?
printf 'CHANGED_EXIT=%s\n' "$changed_exit"

rm -rf "$tmpdir"
```

This demonstrates correspondence among the supplied artifacts. A self-consistent
replacement of the JSON, integrity metadata, and Markdown can still pass.
Basisline does not establish authorship, historical existence, currentness,
evidence truth, or history completeness.

## Try the browser reference app

```bash
# Run from the repository root.
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open **http://127.0.0.1:8000/reference-app/**. (Any static file server works — this
just needs to not be opened via `file://`, since the app fetches
`schema/*.json` at runtime. See [reference-app/README.md](reference-app/README.md)
for why.)

Records are append-only by specification: existing records MUST NOT be modified.
This is a workflow requirement; the files remain editable and the application
does not enforce or verify their history.

## Optional Integrity companions

[Integrity v0.1](spec/integrity-v0.1.md) creates a detached SHA-256 fingerprint
and a [literal-safe Markdown projection](spec/markdown-renderer-profile-0.1.md)
from an existing JSON record. It does not change the frozen record schemas or
the browser app's legacy renderer. Node.js 22 or later is required for this CLI.

```bash
npm ci --ignore-scripts
node integrity/cli.js generate --record examples/marketing-budget-receipt.json --integrity receipt.integrity.json --markdown receipt.md
node integrity/cli.js verify --record examples/marketing-budget-receipt.json --integrity receipt.integrity.json --markdown receipt.md --json
```

Output paths must not already exist. Generation is not atomic across files;
inspect any reported partial outputs after a failure. The CLI supports regular
files on Linux and macOS with trusted parent directories.

Reports distinguish individual checks. Matching a supplied fingerprint does not
establish authorship, historical existence, currentness, or history completeness.
Replacing the JSON, fingerprint, and Markdown together can pass these checks.
An independently retained fingerprint can be compared with `--expected-digest`;
the tool does not establish that comparison point's provenance.

## Repository Structure

```
spec/            — the specification itself (versioned)
schema/          — JSON Schema files for validation
examples/        — sample receipt/outcome pairs
renderer/        — record → Markdown rendering logic
integrity/       — optional strict ingestion, fingerprint, and verification CLI
reference-app/   — the minimal local form + generator
tests/           — schema and renderer tests
CONTRIBUTING.md
LICENSE
SPEC-LICENSE
```

## Status

**v0.1 — specification frozen for reference implementation testing. Breaking changes may occur before v1.0.**

## Attribution

Basisline was initiated as an open specification by Shikhar Jha. The specification is vendor-neutral and may be implemented independently.

*Developed with support from [Michvi LLP](https://michvi.com).*

## Testing

Install the Python test dependency and locked Node test dependencies:

```bash
python3 -m pip install -r requirements-dev.txt
npm ci --ignore-scripts
```

Then run the complete test suite:

```bash
npm test
```

The suite covers the pre-existing schema, renderer, and browser logic tests plus
Integrity adversarial, standards-vector, filesystem, and Markdown byte tests.
Run `npm run test:legacy` or `npm run test:integrity` to select either suite.

## Acknowledgements

Basisline was initiated by Shikhar Jha as an open, vendor-neutral specification.

Special acknowledgement is extended to Ashok Kumar Jha and Vinita Jha for their continued support of the work, and to [Michvi LLP](https://michvi.com) for supporting its development and publication.
