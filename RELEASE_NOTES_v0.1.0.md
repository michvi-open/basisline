# Basisline v0.1.0

**Preserve the basis of the decision.**

An open specification for preserving the evidence, assumptions, and outcomes behind important business decisions.

No account. No proprietary database. No vendor lock-in.

> Basisline does not tell you what decision to make. It preserves what made the decision reasonable at the time.

---

## What's in this release

- **[spec/v0.1.md](spec/v0.1.md)** — the frozen v0.1 specification
- **schema/** — JSON Schema for the two record types: Decision Receipt and Outcome Record
- **examples/** — 5 decision-type pairs (marketing budget, vendor approval, campaign pause, finance/payment, product rollout), all schema-validated
- **renderer/** — a dependency-free, deterministic JSON → Markdown renderer
- **reference-app/** — a minimal local, browser-only form for creating receipts and outcomes. No build step, no server-side code.

**34/34 tests passing** across schema validation, renderer, and reference-app logic.

## Try it

```bash
git clone https://github.com/michvi-open/basisline.git
cd basisline/reference-app
python3 -m http.server 8000
```

Open http://localhost:8000.

## Core model

```
Decision Receipt:   Evidence → Assumptions → Decision
Outcome Record:     Decision Receipt → Outcome → Learning
```

Both record types are immutable once created. An outcome never edits its receipt — it's a separate, linked record. A revised decision creates a new receipt with `revision.supersedes` pointing to the original.

## What this is not

Per the spec's non-goals: not an analytics tool, not a CRM or finance system, not a dashboard, not a cloud service, not an AI decision-recommendation engine.

## License

- Specification: [CC0 1.0](SPEC-LICENSE) — freely implementable by anyone
- Reference implementation code: [MIT](LICENSE)

## What's next

Cross-record validation, signing, third-party integrations, and notifications are intentionally out of scope for v0.1 — see [BACKLOG.md](BACKLOG.md). They'll only get built if real usage pulls them in.

---

*Basisline was initiated as an open specification by Shikhar Jha. The specification is vendor-neutral and may be implemented independently. Developed with support from Michvi LLP.*
