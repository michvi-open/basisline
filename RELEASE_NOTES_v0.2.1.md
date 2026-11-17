# Basisline v0.2.1

Basisline v0.2.1 is a maintenance release of the browser reference app. It makes the form refuse or flag input that would otherwise be changed or later rejected by the Basisline Integrity v0.1 CLI, adds a Content-Security-Policy to the reference app, and clarifies the project's scope in the README.

It does not change the Basisline v0.1 record specification, the schemas, the examples, the Integrity v0.1 implementation, canonicalization, fingerprints or test vectors.

## Numeric input correctness

The reference app previously converted typed numbers with `Number()`, which could alter a value without telling the user. For example, `9007199254740993` became `9007199254740992`, `1e-400` became `0`, and `1.0000000000000001` in a whole-number field became `1`. Some of the resulting records were then refused by the Integrity CLI.

The app now applies the published Integrity v0.1 numeric acceptance profile to the exact text the user typed:

- it blocks generation for values that overflow, underflow to zero, whole numbers that binary64 cannot hold exactly, and fractions in whole-number fields, naming the field and the value the number would have become;
- it generates decimals that binary64 rounds, but shows a warning with both the typed and the stored value;
- it leaves value-preserving respellings (for example `1e2` stored as `100`) unchanged and without a warning.

## Text correctness

A pasted Unicode noncharacter (such as U+FFFE or U+FDD0) or an unpaired surrogate could pass the app's schema validation but be refused by the Integrity CLI. The app now applies Integrity's Unicode rule to every string in a built receipt or outcome and blocks generation with the field path and a plain-language reason.

The reference-app README now states what the form checks (numbers and characters) and which Integrity CLI limits it does not check in the browser (the 1 MiB input budget; year-0000 and `:60`-second dates).

## Reference-app Content-Security-Policy

The reference app's page now declares a strict Content-Security-Policy that permits only same-origin scripts, styles and fetches, and disallows plugins, base-URL changes and form submission. This is defence in depth: the app uses no inline script, inline style or event-handler attributes, and no exploitable injection issue in the reference app is known.

## README scope clarification

The README now states that Basisline is a standalone decision-record format and reference implementation for evidence documentation and deterministic integrity verification, and that its specification and licences apply only to the materials expressly identified within the project. This is a clarification only; licence text, licence scope and copyright notices are unchanged.

## Tests

New and extended tests cover:

- agreement between the app's numeric check and `integrity/numbers.js` over the RFC 8785 vectors, numeric boundaries and a seeded random corpus;
- agreement between the app's text check and Integrity's Unicode check for every BMP code unit and every plane-end code point;
- the Content-Security-Policy, the absence of inline scripts, styles, handlers and remote resources, and escaping of HTML interpolations in the app;
- app integration cases for numeric and text blocking and warnings in three timezones.

## Assurance boundary

The assurance boundary of Basisline Integrity v0.1 is unchanged. The reference app's checks reduce the chance of generating a record the Integrity CLI refuses; they do not establish authorship, provenance, truth of evidence, currentness, completeness, immutability or non-repudiation.

## Compatibility

Basisline v0.2.1 retains the Basisline v0.1 record specification and schemas and the Basisline Integrity v0.1 profile. Records valid under v0.2.0 remain valid.

Node.js 22 or later is required for the JavaScript tooling.
