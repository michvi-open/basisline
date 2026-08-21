#!/usr/bin/env python3
"""
Validates every record in examples/ against its corresponding v0.1 schema.

Usage: python3 tests/validate_examples.py
"""
import json
import sys
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schema"
EXAMPLES_DIR = ROOT / "examples"

SCHEMAS = {
    "receipt": json.loads((SCHEMA_DIR / "decision-receipt.schema.json").read_text()),
    "outcome": json.loads((SCHEMA_DIR / "outcome-record.schema.json").read_text()),
}


def validate_file(path: Path) -> tuple[bool, str]:
    record = json.loads(path.read_text())
    record_type = record.get("record_type")
    if record_type not in SCHEMAS:
        return False, f"unknown or missing record_type: {record_type!r}"
    try:
        jsonschema.validate(instance=record, schema=SCHEMAS[record_type])
    except jsonschema.ValidationError as e:
        return False, str(e).splitlines()[0]
    return True, record_type


def main() -> int:
    example_files = sorted(EXAMPLES_DIR.glob("*.json"))
    if not example_files:
        print("No example files found in examples/.")
        return 1

    failures = 0
    for path in example_files:
        ok, detail = validate_file(path)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {path.relative_to(ROOT)}  ({detail})")
        if not ok:
            failures += 1

    print()
    if failures:
        print(f"{failures} of {len(example_files)} example(s) failed validation.")
        return 1

    print(f"All {len(example_files)} example(s) valid against Basisline v0.1 schemas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
