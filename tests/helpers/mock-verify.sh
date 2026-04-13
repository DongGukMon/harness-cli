#!/usr/bin/env bash
# Mock harness-verify.sh for integration tests.
# Reads MOCK_VERIFY_MODE env: pass | fail | error | crash
# Writes eval report to arg $2 with appropriate content.

CHECKLIST="$1"
REPORT="$2"
MODE="${MOCK_VERIFY_MODE:-pass}"

mkdir -p "$(dirname "$REPORT")"

case "$MODE" in
  pass)
    cat > "$REPORT" <<EOF
# Verification Report

- Date: $(date +"%Y-%m-%d %H:%M:%S")

## Results

| Check | Status | Output |
|-------|--------|--------|
| mock  | PASS   | ok     |

## Summary

All checks passed.
EOF
    exit 0
    ;;
  fail)
    cat > "$REPORT" <<EOF
# Verification Report

## Results

| Check | Status | Output |
|-------|--------|--------|
| mock  | FAIL   | error  |

## Summary

1 check failed.
EOF
    exit 1
    ;;
  error)
    # Report without ## Summary
    echo "# Incomplete Report" > "$REPORT"
    echo "script crashed" >&2
    exit 2
    ;;
  crash)
    # No report at all
    echo "fatal: crashed before writing report" >&2
    exit 3
    ;;
esac

exit 0
