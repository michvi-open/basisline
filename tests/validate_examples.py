#!/usr/bin/env python3
"""
Validates every record in examples/ against its corresponding v0.1 schema.

Usage: python3 tests/validate_examples.py
"""
import json
import re
import sys
from pathlib import Path
from typing import Optional

import jsonschema
import rfc3339_validator  # Required: jsonschema otherwise silently skips date-time checks.

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = ROOT / "schema"
EXAMPLES_DIR = ROOT / "examples"

SCHEMAS = {
    "receipt": json.loads((SCHEMA_DIR / "decision-receipt.schema.json").read_text()),
    "outcome": json.loads((SCHEMA_DIR / "outcome-record.schema.json").read_text()),
}

FORMAT_CHECKER = jsonschema.FormatChecker()
assert "date-time" in FORMAT_CHECKER.checkers, "date-time format validation is unavailable"


@FORMAT_CHECKER.checks("date-time")
def strict_date_time(value: object) -> bool:
    # rfc3339-validator's `$` regex accepts a final newline. Require the entire
    # string to be a timestamp, matching the browser/Node validator.
    return not isinstance(value, str) or (
        value == value.strip() and rfc3339_validator.validate_rfc3339(value.upper())
    )


def unresolved_format(value: str, format_name: str) -> bool:
    # Diagnose known library exclusions, not the validity of leap-second
    # occurrences. Probe a supported year/second without changing the record.
    # All other syntax/calendar checks must still pass before returning UNRESOLVED.
    if format_name not in ("date", "date-time") or not isinstance(value, str):
        return False
    probe = "2000" + value[4:] if value.startswith("0000-") else value
    if format_name == "date-time":
        probe = re.sub(r"([Tt]\d{2}:\d{2}):60(?=[.Zz+-])", r"\1:59", probe, count=1)
    return probe != value and FORMAT_CHECKER.conforms(probe, format_name)


def validate_record(record: dict) -> tuple[Optional[bool], str]:
    record_type = record.get("record_type")
    if record_type not in SCHEMAS:
        return False, f"unknown or missing record_type: {record_type!r}"
    unresolved = []
    validator = jsonschema.Draft7Validator(SCHEMAS[record_type], format_checker=FORMAT_CHECKER)
    for error in validator.iter_errors(record):
        if error.validator == "format" and unresolved_format(error.instance, error.validator_value):
            unresolved.append(".".join(map(str, error.path)))
        else:
            return False, str(error).splitlines()[0]
    if unresolved:
        return None, f"date/time library compatibility unresolved at {', '.join(unresolved)}; not a Basisline rejection"
    return True, record_type


def validate_file(path: Path) -> tuple[Optional[bool], str]:
    return validate_record(json.loads(path.read_text()))


def main() -> int:
    example_files = sorted(EXAMPLES_DIR.glob("*.json"))
    if not example_files:
        print("No example files found in examples/.")
        return 1

    failures = 0
    unresolved = 0
    for path in example_files:
        ok, detail = validate_file(path)
        status = "UNRESOLVED" if ok is None else "PASS" if ok else "FAIL"
        print(f"[{status}] {path.relative_to(ROOT)}  ({detail})")
        if ok is None:
            unresolved += 1
        elif not ok:
            failures += 1

    print()
    format_cases = json.loads((ROOT / "tests/date-format-cases.json").read_text())
    for case in format_cases:
        validator = jsonschema.Draft7Validator(
            {"type": "string", "format": case["format"]}, format_checker=FORMAT_CHECKER
        )
        expected = case.get("python_format_valid", case.get("valid"))
        if validator.is_valid(case["value"]) != expected:
            print(f"[FAIL] format regression: {case!r}")
            failures += 1
        # Exercise the record-level distinction, not just the library checker.
        record = json.loads((EXAMPLES_DIR / "marketing-budget-receipt.json").read_text())
        if case["format"] == "date":
            record["decision"]["date"] = case["value"]
        else:
            record["evidence_as_of"] = case["value"]
        expected_status = None if "limitation" in case else case["valid"]
        if validate_record(record)[0] is not expected_status:
            print(f"[FAIL] record format classification: {case!r}")
            failures += 1
        if "limitation" in case:
            del record["decision"]["owner"]
            if validate_record(record)[0] is not False:
                print(f"[FAIL] unresolved format masked a schema error: {case!r}")
                failures += 1

    if failures or unresolved:
        print(f"{failures} check(s) failed; {unresolved} example(s) have unresolved date/time compatibility.")
        return 1

    print(f"All {len(example_files)} example(s) valid against Basisline v0.1 schemas.")
    print(f"All {len(format_cases)} date/date-time regression cases passed, including explicit library-limit classifications.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
