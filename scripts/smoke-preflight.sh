#!/usr/bin/env bash
# smoke-preflight.sh — verify `harness run` reaches Phase 1 spawn in <10s
# (proves the preflight hang fix from the 2026-04-13 hardening spec)
#
# Strategy: run `harness run` in a clean temp git repo with a pseudo-TTY
# (via `script`), kill after 10s, and check that the Advisor Reminder
# for Phase 1 appears in the output — proving that ALL preflight items
# passed and the Phase 1 Claude spawn was initiated.
#
# PASS criteria:
#   - Wallclock elapsed until Phase 1 evidence < 10s
#   - Output contains "Advisor Reminder (Phase 1)" — this prints
#     immediately before spawn('claude', ...) in interactive.ts,
#     proving preflight completed and Phase 1 has been reached.

set -uo pipefail

HARNESS_BIN="$1"
if [[ ! -f "$HARNESS_BIN" ]]; then
  echo "smoke-preflight: harness binary not found at $HARNESS_BIN" >&2
  exit 2
fi

TMP=$(mktemp -d -t harness-smoke-XXXXXX)
OUTPUT_LOG=$(mktemp)
trap 'kill -9 $BGPID 2>/dev/null; wait $BGPID 2>/dev/null; rm -rf "$TMP" "$OUTPUT_LOG"' EXIT

cd "$TMP"
git init -q
git commit --allow-empty -q -m init

T0=$(date +%s)

# Use `script` to provide a pseudo-TTY so preflight's TTY check passes.
# stdout+stderr are merged by `script`; capture everything into OUTPUT_LOG.
script -q /dev/null bash -c "node '$HARNESS_BIN' run 'preflight smoke' --allow-dirty 2>&1" > "$OUTPUT_LOG" 2>&1 &
BGPID=$!

# Wait up to 10s, checking every second for the Phase 1 evidence
FOUND=0
for i in $(seq 1 10); do
  sleep 1
  if grep -q 'Advisor Reminder (Phase 1)' "$OUTPUT_LOG" 2>/dev/null; then
    FOUND=1
    break
  fi
done

T1=$(date +%s)
ELAPSED=$((T1 - T0))

# Kill the background harness + Claude processes
kill -9 $BGPID 2>/dev/null
wait $BGPID 2>/dev/null

echo "preflight smoke elapsed until Phase 1 evidence: ${ELAPSED}s"
echo "output snippet (first 15 lines, ANSI stripped):"
head -15 "$OUTPUT_LOG" | sed 's/\x1b\[[0-9;]*[a-zA-Z]//g; s/^/  /'

if [[ "$FOUND" -eq 1 && "$ELAPSED" -lt 10 ]]; then
  echo "PASS: Phase 1 reached in ${ELAPSED}s (<10s) — Advisor Reminder confirms spawn seam"
  exit 0
fi

if [[ "$ELAPSED" -ge 10 ]]; then
  echo "FAIL: Phase 1 evidence not found within 10s. Possible preflight hang."
  exit 1
fi

echo "FAIL: Phase 1 Advisor Reminder not found in output."
exit 1
