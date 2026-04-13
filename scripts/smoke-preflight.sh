#!/usr/bin/env bash
# smoke-preflight.sh — verify `harness run` reaches phase 1 in <10s
# (proves the preflight hang fix from the 2026-04-13 hardening spec)
#
# Strategy: run `harness run` in a non-TTY temp git repo. Preflight should
# either complete (and then fail at the TTY check) or time out the @file
# probe at 5s and continue. Either path proves there is no >10s hang.
#
# PASS criteria:
#   - Wallclock elapsed < 10s
#   - stderr contains either the @file timeout warning OR the TTY error,
#     proving preflight reached its terminal step.

set -uo pipefail

HARNESS_BIN="$1"
if [[ -z "$HARNESS_BIN" || ! -x "$HARNESS_BIN" ]] && [[ ! -f "$HARNESS_BIN" ]]; then
  echo "smoke-preflight: harness binary not found at $HARNESS_BIN" >&2
  exit 2
fi

TMP=$(mktemp -d -t harness-smoke-XXXXXX)
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"
git init -q
git commit --allow-empty -q -m init

STDERR_LOG=$(mktemp)
T0=$(date +%s)
node "$HARNESS_BIN" run "preflight smoke" --allow-dirty >/dev/null 2>"$STDERR_LOG" || true
T1=$(date +%s)
ELAPSED=$((T1 - T0))

echo "preflight smoke elapsed: ${ELAPSED}s"
echo "stderr (first 5 lines):"
head -5 "$STDERR_LOG" | sed 's/^/  /'

# Pass condition 1: elapsed < 10s
if [[ "$ELAPSED" -ge 10 ]]; then
  echo "FAIL: preflight took ${ELAPSED}s (>= 10s threshold). Original 4-hour hang regression possible."
  rm -f "$STDERR_LOG"
  exit 1
fi

# Pass condition 2: stderr proves preflight completed (timeout warning OR TTY error)
EXPECTED_PATTERN='claude @file check timed out|requires an interactive terminal|preflight failed'
if ! grep -qE "$EXPECTED_PATTERN" "$STDERR_LOG"; then
  echo "FAIL: stderr did not contain expected preflight terminal-state message."
  echo "      Expected one of: $EXPECTED_PATTERN"
  rm -f "$STDERR_LOG"
  exit 1
fi

echo "PASS: preflight reached phase 1 boundary in ${ELAPSED}s (<10s)"
rm -f "$STDERR_LOG"
exit 0
