#!/usr/bin/env bash
set -euo pipefail

# harness-verify.sh — Run eval checklist commands and generate a markdown report.
# Usage: harness-verify.sh <checklist.json> <output-report.md>
#
# checklist.json format:
# {
#   "related_spec": "docs/specs/2026-04-12-example-design.md",
#   "related_plan": "docs/plans/2026-04-12-example.md",
#   "checks": [
#     { "name": "Type Check", "command": "pnpm tsc --noEmit" },
#     { "name": "Lint", "command": "pnpm lint" }
#   ]
# }

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: harness-verify.sh <checklist.json> <output-report.md>"
  echo ""
  echo "Reads a JSON checklist and runs each command sequentially."
  echo "Generates a markdown eval report at the specified output path."
  echo ""
  echo "checklist.json format:"
  echo '  { "related_spec": "...", "related_plan": "...", "checks": [{"name": "...", "command": "..."}] }'
  exit 0
fi

CHECKLIST_FILE="${1:?Error: checklist.json path required as first argument}"
OUTPUT_FILE="${2:?Error: output report path required as second argument}"

if [[ ! -f "$CHECKLIST_FILE" ]]; then
  echo "Error: Checklist file not found: $CHECKLIST_FILE" >&2
  exit 1
fi

# Ensure output directory exists
mkdir -p "$(dirname "$OUTPUT_FILE")"

RELATED_SPEC=$(jq -r '.related_spec // "N/A"' "$CHECKLIST_FILE")
RELATED_PLAN=$(jq -r '.related_plan // "N/A"' "$CHECKLIST_FILE")
CHECK_COUNT=$(jq '.checks | length' "$CHECKLIST_FILE")
DATE=$(date +%Y-%m-%d)

# Start report
cat > "$OUTPUT_FILE" <<EOF
# Auto Verification Report
- Date: $DATE
- Related Spec: $RELATED_SPEC
- Related Plan: $RELATED_PLAN

## Results
| Check | Status | Detail |
|-------|--------|--------|
EOF

# Temporary file for raw output section
RAW_OUTPUT_FILE=$(mktemp)

PASS_COUNT=0
FAIL_COUNT=0

for i in $(seq 0 $((CHECK_COUNT - 1))); do
  NAME=$(jq -r ".checks[$i].name" "$CHECKLIST_FILE")
  COMMAND=$(jq -r ".checks[$i].command" "$CHECKLIST_FILE")

  echo "Running: $NAME ($COMMAND)..." >&2

  STDOUT_FILE=$(mktemp)
  STDERR_FILE=$(mktemp)

  set +e
  # Subshell isolates per-check cwd/env mutations (e.g. `cd subdir && pnpm test`)
  # so a preceding check cannot break `>> "$OUTPUT_FILE"` via a stale cwd.
  ( eval "$COMMAND" ) > "$STDOUT_FILE" 2> "$STDERR_FILE"
  EXIT_CODE=$?
  set -e

  if [[ $EXIT_CODE -eq 0 ]]; then
    STATUS="pass"
    DETAIL=""
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    STATUS="**FAIL**"
    # Extract first meaningful line of stderr as detail
    DETAIL=$(head -5 "$STDERR_FILE" | tr '\n' ' ' | cut -c1-80)
    if [[ -z "$DETAIL" ]]; then
      DETAIL="exit code $EXIT_CODE"
    fi
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  echo "| $NAME | $STATUS | $DETAIL |" >> "$OUTPUT_FILE"

  # Append to raw output
  cat >> "$RAW_OUTPUT_FILE" <<RAWEOF

### $NAME
**Command:** \`$COMMAND\`
**Exit code:** $EXIT_CODE

<details>
<summary>stdout (truncated to 100 lines)</summary>

\`\`\`
$(head -100 "$STDOUT_FILE")
\`\`\`

</details>

<details>
<summary>stderr (truncated to 50 lines)</summary>

\`\`\`
$(head -50 "$STDERR_FILE")
\`\`\`

</details>
RAWEOF

  rm -f "$STDOUT_FILE" "$STDERR_FILE"
done

# Append summary and raw output
cat >> "$OUTPUT_FILE" <<EOF

## Summary
- Total: $CHECK_COUNT checks
- Pass: $PASS_COUNT
- Fail: $FAIL_COUNT

## Raw Output
EOF

cat "$RAW_OUTPUT_FILE" >> "$OUTPUT_FILE"
rm -f "$RAW_OUTPUT_FILE"

echo "" >&2
echo "Report written to: $OUTPUT_FILE" >&2
echo "Result: $PASS_COUNT/$CHECK_COUNT passed" >&2

if [[ $FAIL_COUNT -gt 0 ]]; then
  exit 1
fi
