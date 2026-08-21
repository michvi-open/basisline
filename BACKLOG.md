# Backlog

Ideas noted for future consideration. None of these are part of the v0.1
scope, and none require changes to the frozen v0.1 specification to add
later — they're additive, not corrective.

---

## Future consideration: linked-record temporal validation

**Observation:** An Outcome Record's `recorded_on` can currently be earlier
than the `decision.date` of the Decision Receipt it references
(`receipt_id`). Logically odd, but not currently rejected.

**Why this is not a v0.1 fix:**

Basisline's schema validation operates on a single record at a time — that's
what keeps a receipt or outcome a portable, standalone file. Checking
`recorded_on >= receipt.decision.date` requires looking up the *other*
record, which is a cross-record validation problem, not a JSON Schema
problem. Adding it to v0.1 would mean:

- the validator needs receipt lookup capability
- standalone-file validation stops being simple (a file can no longer be
  validated in isolation — you'd need its linked receipt present too)
- the reference app would need cross-record state instead of one form at a
  time
- the "no DB, no server, fully portable records" model gets meaningfully
  more complex for a check that's about data hygiene, not about the
  specification's contract

**If this is ever built:** it belongs in a separate, optional validation
layer — e.g. a `tools/cross-check.js` script that takes a directory of
records and checks referential/temporal consistency across them — not in
`schema/*.json` or `reference-app/lib/validate.js`.

---

## Other future/traction-driven ideas (not started)

These are explicitly out of scope until there's real usage pulling them in:

- Cryptographic signing of records
- Third-party integrations (Slack, Notion, Jira, etc.)
- Notifications / review-date reminders
- Any form of hosted service, API, or account system

Per `CONTRIBUTING.md`, these are not accepted as PRs against this repo —
build them as separate projects on top of Basisline if you need them.
