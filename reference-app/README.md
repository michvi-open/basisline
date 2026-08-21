# Basisline Reference App (v0.1)

A minimal, local, browser-only tool for creating Decision Receipts and
Outcome Records that conform to the [Basisline v0.1 specification](../spec/v0.1.md).

No build step. No dependencies. No server-side code. No database, auth,
cloud sync, dashboard, AI, or analytics — see the spec's non-goals.

## Running it

Browsers block `fetch()` of local files when a page is opened directly via
`file://`, and this app fetches the schema files at runtime (so the schema
stays the single source of truth instead of being duplicated into the app).
So run a tiny local static server from this folder instead of double-clicking `index.html`:

```bash
cd reference-app
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser.

(Any static file server works — `npx serve`, `php -S localhost:8000`,
etc. Nothing here requires Python specifically.)

## How it works

```
form input → buildReceiptObject() / buildOutcomeObject()  (lib/form-mapping.js)
           → validate() against schema/*.json              (lib/validate.js)
           → renderReceiptMarkdown() / renderOutcomeMarkdown()  (../renderer/render.js)
           → download as .json and .md
```

The app does not encode its own validation rules — `lib/validate.js` is a
small generic JSON Schema engine that reads `schema/*.json` at runtime.
If the schema rejects a record, the form shows why. The schema files in
this folder are copies of the canonical ones in `../schema/`; `tests/`
checks they stay in sync.
