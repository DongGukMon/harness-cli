# Gate Escalation Forensics for Issue #66

Use this checklist before enabling any fresh-session fallback for Codex gate reviewers after a developer chooses **Continue (C)** at the gate retry limit.

## Purpose

A repeated reject after a C-boundary can come from two different causes:

1. **Reviewer anchoring** — the resumed Codex session repeats prior critique even though current artifacts changed enough to resolve it.
2. **Artifact non-compliance** — the current spec/plan/eval still contains the cited flaw, so the reviewer is correctly rejecting.

The first patch for #66 intentionally keeps normal session reuse and injects an escalation reset notice. Only use the fresh-session fallback when the evidence below points to reviewer anchoring.

## Evidence Inputs

Collect these files from the run directory:

- `gate-<phase>-cycle-<n>-retry-<r>-feedback.md` for the rejected pre-C cycle.
- `gate-<phase>-feedback.md` or the post-C `gate-<phase>-cycle-<n+1>-retry-<r>-feedback.md` for the reset-notice cycle.
- The exact gate artifacts used by the prompt:
  - Gate 2: `spec`.
  - Gate 4: `spec` + `plan`.
  - Gate 7 full: `spec` + `plan` + `eval_report` + diff/metadata prompt sections.
  - Gate 7 light: combined `spec` + `eval_report` + diff/metadata prompt sections.
- Isolated Codex transcripts/logs under the run's `codex-home` or session logging directory when available.

## Normalized Reject-Feedback Hash

Hash the reviewer comments after normalization. The goal is to detect semantically identical feedback while ignoring run noise.

Remove or normalize:

- Timestamps and datestamps.
- Retry and cycle numbers.
- Absolute temporary paths, home-directory paths, and run IDs.
- Whitespace-only differences.
- Markdown code-fence wrapper noise that does not change the enclosed finding.

Retain:

- Severity labels (`P0`, `P1`, `P2`, `P3`).
- `Location`, `Issue`, `Suggestion`, and `Evidence` bodies.
- Cited identifiers, helper names, endpoint names, file names, and assertions.
- Summary text when it carries a rejection reason.

## Artifact Hash Comparison

Compute content hashes for the exact artifacts supplied to the relevant gate prompt before and after the C-boundary cycle.

- If the artifact hash did **not** change, repeated feedback is not evidence of anchoring.
- If the artifact hash changed, inspect whether the changed region addresses the cited finding.
- For Gate 7, include the rendered diff/metadata section or record the implementation commit range used to produce it.

## Cited-Identifier Absence Check

Extract concrete identifiers from the prior rejection and search current artifacts for them.

For the original #66 report, check for:

- `mintToken()`
- `mockVerificationService.getVerificationClaims.mockResolvedValueOnce`
- Any future code-like token called out by `Location`, `Issue`, `Suggestion`, or `Evidence`.

Decision rule:

- Identifiers still present in the same rejected role/path usually indicate artifact non-compliance.
- Identifiers absent or materially replaced, combined with unchanged reject-feedback hash, supports anchoring.

## Transcript Anchoring Scan

Inspect the resumed Codex transcript for memory-presupposition phrases and evidence of stale reasoning.

Flag phrases such as:

- `as I noted earlier`
- `again`
- `previously`
- `still`
- `already pointed out`
- `this remains`

Then compare whether the reasoning quotes current artifact content verbatim or recycles prior wording without current-artifact evidence.

## Fresh-Session Fallback Trigger

Implement the C-boundary fresh-session fallback only when **all** conditions are true after the reset-notice patch is in place:

1. The post-banner C-boundary retry produces the same normalized reject-feedback hash as the pre-C rejection.
2. The relevant artifact hash changed across the C boundary.
3. The prior rejection's concrete cited identifiers are absent or materially replaced in the current artifacts.
4. Transcript scan indicates prior-context anchoring rather than fresh artifact analysis.

When the trigger is met, clear only the affected gate at the C boundary:

```ts
state.phaseCodexSessions[key] = null;
deleteGateSidecars(runDir, phase);
```

Do not clear sessions for normal reject retries; session reuse remains intentional there for cost, latency, and delta-review continuity.
