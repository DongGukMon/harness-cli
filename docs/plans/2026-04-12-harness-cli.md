# Harness CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI tool that orchestrates the 7-phase harness lifecycle with multi-session isolation, crash-safe state management, and process group control.

**Architecture:** CLI orchestrator that manages phase transitions via atomic state.json writes, spawns Claude/Codex/shell subprocesses with PGID isolation, and provides resume/skip/jump commands for recovery. All inter-phase context is file-based — no shared sessions.

**Tech Stack:** TypeScript, Node.js (>=18), Commander.js (CLI parsing), chokidar (file watching), uuid (phaseAttemptId)

**Related Spec:** `docs/specs/2026-04-12-harness-cli-design.md` (rev 69)

---

## File Structure

```
harness-cli/
├── package.json
├── tsconfig.json
├── .gitignore
├── bin/
│   └── harness.ts                  # CLI entrypoint (commander setup)
├── src/
│   ├── types.ts                    # All TypeScript types and enums
│   ├── config.ts                   # Constants, model settings, paths
│   ├── state.ts                    # Atomic state.json read/write
│   ├── lock.ts                     # repo.lock/run.lock acquisition + liveness
│   ├── git.ts                      # Git utilities (ancestry, anchors, external commits)
│   ├── process.ts                  # Process start time, PGID management
│   ├── preflight.ts                # Dependency validation (items 1-10)
│   ├── artifact.ts                 # normalize_artifact_commit + Phase 6 preconditions
│   ├── phases/
│   │   ├── interactive.ts          # Claude subprocess spawn/watch/sentinel
│   │   ├── gate.ts                 # Codex gate execution + verdict parsing
│   │   ├── verify.ts               # harness-verify.sh execution
│   │   └── runner.ts               # Phase lifecycle state machine
│   ├── context/
│   │   ├── assembler.ts            # Phase-specific prompt assembly
│   │   └── prompts/                # Phase-specific prompt templates
│   │       ├── phase-1.md
│   │       ├── phase-3.md
│   │       └── phase-5.md
│   ├── commands/
│   │   ├── run.ts
│   │   ├── resume.ts
│   │   ├── status.ts
│   │   ├── list.ts
│   │   ├── skip.ts
│   │   └── jump.ts
│   ├── ui.ts                       # TTY prompts (escalation/error menus)
│   ├── signal.ts                   # SIGINT/SIGTERM handler registration + shutdown
│   └── root.ts                     # .harness/ root discovery + current-run pointer
├── tests/
│   ├── state.test.ts
│   ├── lock.test.ts
│   ├── git.test.ts
│   ├── process.test.ts
│   ├── preflight.test.ts
│   ├── artifact.test.ts
│   ├── phases/
│   │   ├── interactive.test.ts
│   │   ├── gate.test.ts
│   │   ├── verify.test.ts
│   │   └── runner.test.ts
│   ├── context/
│   │   └── assembler.test.ts
│   ├── signal.test.ts
│   ├── root.test.ts
│   ├── commands/
│   │   ├── run.test.ts
│   │   ├── resume.test.ts
│   │   ├── skip.test.ts
│   │   └── jump.test.ts
│   ├── integration/
│   │   └── lifecycle.test.ts       # End-to-end CLI lifecycle in temp repos
│   └── helpers/
│       └── test-repo.ts            # Temp git repo helper for tests
└── docs/
    ├── specs/2026-04-12-harness-cli-design.md
    └── plans/2026-04-12-harness-cli.md
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json` (overwrite), `tsconfig.json`, `.gitignore`, `tests/helpers/test-repo.ts`

- [ ] **Step 1: Create .gitignore** (assumes git repo already initialized)
```
node_modules/
dist/
.harness/
*.tsbuildinfo
```

- [ ] **Step 2: Update package.json**
```json
{
  "name": "harness-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "harness": "./dist/bin/harness.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "chokidar": "^4.0.0",
    "uuid": "^10.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "bin/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Install dependencies and verify**
```bash
pnpm install
pnpm run lint  # Should pass with no source files yet
```

- [ ] **Step 5: Create test-repo helper**
```typescript
// tests/helpers/test-repo.ts
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

export function createTestRepo(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'harness-test-'));
  execSync('git init && git commit --allow-empty -m "init"', { cwd: path });
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}
```

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "chore: project scaffolding"
```

---

## Task 2: Types & Config

**Files:**
- Create: `src/types.ts`, `src/config.ts`

- [ ] **Step 1: Write types** — All TypeScript interfaces from spec section "state.json" and "이벤트별 상태 전이". Key types:

```typescript
// src/types.ts
export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'error';
export type RunStatus = 'in_progress' | 'completed' | 'paused';
export type PauseReason = 'gate-escalation' | 'verify-escalation' | 'gate-error' | 'verify-error';
export type PendingActionType = 'reopen_phase' | 'rerun_gate' | 'rerun_verify' | 'show_escalation' | 'show_verify_error' | 'skip_phase';

export interface PendingAction {
  type: PendingActionType;
  targetPhase: PhaseNumber;
  sourcePhase: PhaseNumber | null;
  feedbackPaths: string[];
}

export interface HarnessState {
  runId: string;
  currentPhase: number; // 1-7 or 8 (terminal)
  status: RunStatus;
  autoMode: boolean;
  task: string;
  baseCommit: string;
  implRetryBase: string;
  codexPath: string;
  externalCommitsDetected: boolean;
  artifacts: {
    spec: string;
    plan: string;
    decisionLog: string;
    checklist: string;
    evalReport: string;
  };
  phases: Record<string, PhaseStatus>; // "1"-"7"
  gateRetries: Record<string, number>; // "2","4","7"
  verifyRetries: number;
  pauseReason: PauseReason | null;
  specCommit: string | null;
  planCommit: string | null;
  implCommit: string | null;
  evalCommit: string | null;
  verifiedAtHead: string | null;
  pausedAtHead: string | null;
  pendingAction: PendingAction | null;
  phaseOpenedAt: Record<string, number | null>; // "1","3","5"
  phaseAttemptId: Record<string, string | null>; // "1","3","5"
}

export interface LockData {
  cliPid: number;
  childPid: number | null;
  childPhase: number | null;
  runId: string;
  startedAt: number | null;
  childStartedAt: number | null;
}

export interface GateResult { exitCode: number; timestamp: number; }
export interface VerifyResult { exitCode: number; hasSummary: boolean; timestamp: number; }
```

- [ ] **Step 2: Write config**
```typescript
// src/config.ts
export const PHASE_MODELS: Record<number, string> = {
  1: 'claude-opus-4-6',
  3: 'claude-sonnet-4-6',
  5: 'claude-sonnet-4-6',
};
export const GATE_TIMEOUT_MS = 120_000;
export const VERIFY_TIMEOUT_MS = 300_000;
export const SIGTERM_WAIT_MS = 5_000;
export const GATE_RETRY_LIMIT = 3;
export const VERIFY_RETRY_LIMIT = 3;
export const MAX_FILE_SIZE_KB = 200;
export const MAX_DIFF_SIZE_KB = 50;
export const MAX_PROMPT_SIZE_KB = 500;
export const PER_FILE_DIFF_LIMIT_KB = 20;
```

- [ ] **Step 3: Verify types compile**
```bash
pnpm run lint
```

- [ ] **Step 4: Commit**
```bash
git add src/types.ts src/config.ts && git commit -m "feat: add types and config"
```

---

## Task 3: Atomic State Manager

**Files:**
- Create: `src/state.ts`, `tests/state.test.ts`

- [ ] **Step 1: Write failing tests** for state read/write/atomic rename:

```typescript
// tests/state.test.ts — test cases:
// 1. writeState creates state.json atomically (tmp → fsync → rename)
// 2. readState returns parsed HarnessState
// 3. readState returns null for missing state.json
// 4. readState throws for corrupted JSON
// 5. state.json.tmp recovery: tmp exists, state.json absent → restore
// 6. createInitialState returns correct default values
```

- [ ] **Step 2: Run tests — verify they fail**
```bash
pnpm test tests/state.test.ts
```

- [ ] **Step 3: Implement state.ts** — Key API:
```typescript
export function writeState(runDir: string, state: HarnessState): void
export function readState(runDir: string): HarnessState | null
export function createInitialState(runId: string, task: string, baseCommit: string, codexPath: string, autoMode: boolean): HarnessState
```
Implementation: `writeFileSync(tmp)` → `fsyncSync(fd)` → `renameSync(tmp, target)`. See spec "state.json 쓰기" for full contract.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 4: Git Utilities

**Files:**
- Create: `src/git.ts`, `tests/git.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/git.test.ts — test cases:
// 1. getGitRoot returns repo root path
// 2. getGitRoot throws in non-git directory
// 3. getHead returns HEAD sha
// 4. getHead throws in empty repo
// 5. isAncestor returns true for ancestor commit
// 6. isAncestor returns false for non-ancestor
// 7. isWorkingTreeClean returns true for clean repo
// 8. isWorkingTreeClean returns false for dirty repo
// 9. hasStagedChanges detects staged files
// 10. getStagedFiles returns list of staged file paths
// 11. generateRunId normalizes slugs correctly (Unicode, length, dedup)
// 12. detectExternalCommits with pausedAtHead set → only checks pausedAtHead..HEAD
// 13. detectExternalCommits with pausedAtHead null → falls back to baseCommit, excludes known range
// 14. detectExternalCommits excludes full impl range (baseCommit..implCommit) not just anchor SHA
// 15. updateExternalCommitsDetected: once true, never reset to false
// 16. Phase 7 recheck: recalculates at prompt assembly time using evalCommit..HEAD
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement git.ts** — Key API:
```typescript
export function getGitRoot(cwd?: string): string
export function getHead(cwd?: string): string
export function isAncestor(ancestor: string, descendant: string, cwd?: string): boolean
export function isWorkingTreeClean(cwd?: string): boolean
export function hasStagedChanges(cwd?: string): boolean
export function getStagedFiles(cwd?: string): string[]
export function generateRunId(task: string, harnessDir: string): string
export function detectExternalCommits(baseCommit: string, knownAnchors: string[], cwd?: string): string[]
```
All functions wrap `execSync('git ...')`. See spec "runId 생성 규칙" for slug normalization (6 steps).

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 5: Process Utilities

**Files:**
- Create: `src/process.ts`, `tests/process.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/process.test.ts — test cases:
// 1. getProcessStartTime returns epoch seconds for current process
// 2. getProcessStartTime returns null for nonexistent PID
// 3. isProcessGroupAlive returns true for own PGID
// 4. isProcessGroupAlive returns false for nonexistent PGID
// 5. killProcessGroup sends SIGTERM then SIGKILL after timeout
// 6. Platform detection (macOS vs Linux start time method)
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement process.ts** — Key API:
```typescript
export function getProcessStartTime(pid: number): number | null  // epoch seconds
export function isProcessGroupAlive(pgid: number): boolean        // kill(-pgid, 0)
export function killProcessGroup(pgid: number, waitMs?: number): Promise<void>
export function isPidAlive(pid: number): boolean
```
See spec "startedAt / childStartedAt 저장 형식" for platform-specific start time (Linux: `/proc/<pid>/stat`, macOS: `ps -o etimes=`).

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 6: Lock Manager

**Files:**
- Create: `src/lock.ts`, `tests/lock.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/lock.test.ts — test cases:
// 1. acquireLock creates repo.lock + run.lock atomically (O_EXCL)
// 2. acquireLock fails with EEXIST when lock held
// 3. acquireLock detects stale lock (dead cliPid) and recovers
// 4. acquireLock detects live lock and aborts
// 5. releaseLock deletes both lock files
// 6. updateLockChild writes childPid/childPhase via atomic rename
// 7. clearLockChild nullifies child fields
// 8. readLock parses lock JSON correctly
// 9. readLock returns null for missing lock
// 10. repo.lock.tmp recovery: parse + liveness check + cleanup
// 11. Stale lock cleanup includes correct run.lock path from stored runId
// 12. Orphaned run.lock: repo.lock absent + run.lock present → delete run.lock and proceed
// 13. cliPid alive + startedAt matches → active (real live process)
// 14. cliPid alive + startedAt mismatch → PID reuse, stale lock
// 15. cliPid alive + startedAt null → active (can't prove reuse, safe default)
// 16. cliPid dead + childPid PGID alive → active (even without leader start time match)
// 17. cliPid dead + childPid PGID dead (ESRCH) → stale
// 18. repo.lock.tmp unreadable (parse failure) → abort with manual-recovery error, no auto-delete
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement lock.ts** — Key API:
```typescript
export function acquireLock(harnessDir: string, runId: string): LockData
export function releaseLock(harnessDir: string, runId: string): void
export function updateLockChild(harnessDir: string, childPid: number, childPhase: number): void
export function clearLockChild(harnessDir: string): void
export function readLock(harnessDir: string): LockData | null
export function checkStaleLock(harnessDir: string): 'none' | 'stale' | 'active'
```
See spec "원자적 lock 획득", "liveness 검사 (authoritative)", "crash 복구" for contracts.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 7: Preflight Validation

**Files:**
- Create: `src/preflight.ts`, `tests/preflight.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/preflight.test.ts — test cases:
// 1. Full preflight (all 10 items) passes in valid environment
// 2. Each item fails individually with correct error message
// 3. Phase-scoped preflight checks only required items
// 4. Platform check rejects win32
// 5. TTY check rejects non-TTY
// 6. Codex path glob resolution finds latest version
// 7. claude @file weak-signal check
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement preflight.ts** — Key API:
```typescript
export type PreflightItem = 'git' | 'head' | 'node' | 'claude' | 'claudeAtFile' | 'verifyScript' | 'jq' | 'codexPath' | 'platform' | 'tty';
export function runPreflight(items: PreflightItem[], cwd?: string): { codexPath?: string }
export function getPreflightItems(phaseType: 'interactive' | 'gate' | 'verify' | 'terminal' | 'ui_only'): PreflightItem[]
```
See spec "의존성 preflight" table for which items each phase type needs.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 8: Artifact Management

**Files:**
- Create: `src/artifact.ts`, `tests/artifact.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/artifact.test.ts — test cases:
// 1. normalizeArtifactCommit creates commit for new file
// 2. normalizeArtifactCommit is no-op for already-committed file
// 3. normalizeArtifactCommit fails when non-target files are staged
// 4. normalizeArtifactCommit recovers from interrupted git add (target-only staged)
// 5. phase6Preconditions: deletes untracked eval report
// 6. phase6Preconditions: unstages + deletes staged-new eval report
// 7. phase6Preconditions: git rm + commit for tracked eval report
// 8. phase6Preconditions: aborts when non-eval files dirty
// 9. phase6Preconditions: clean tree final check
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement artifact.ts** — Key API:
```typescript
export function normalizeArtifactCommit(filePath: string, message: string, cwd?: string): boolean // returns true if new commit
export function runPhase6Preconditions(evalReportPath: string, runId: string, cwd?: string): void
```
See spec "normalize_artifact_commit 절차" and "Phase 6 진입 전 사전 조건" for complete contract.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 9: Interactive Phase Runner

**Files:**
- Create: `src/phases/interactive.ts`, `tests/phases/interactive.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/phases/interactive.test.ts — test cases:
// 1. spawnInteractive launches claude with correct args (@file, --model)
// 2. Sentinel creation detected via file watch
// 3. Phase completion: sentinel (fresh phaseAttemptId) + exit + artifacts valid
// 4. Phase failure: exit without sentinel → status = failed
// 5. Stale sentinel (wrong phaseAttemptId) treated as absent
// 6. Phase start clears old sentinel + Phase 1/3 artifacts
// 7. Process group cleanup after leader exit (bounded wait + SIGTERM/SIGKILL)
// 8. phaseAttemptId injected into prompt
// 9. Lock childPid/childPhase/childStartedAt recorded on spawn
// 10. Lock childPid cleared only after process group ESRCH confirmed
// 11. Phase 1/3 artifact mtime freshness: mtime >= phaseOpenedAt required
// 12. Stale artifact (mtime < phaseOpenedAt) → completion fails even if sentinel fresh
// 13. Phase 5 completion: requires git log <implRetryBase>..HEAD >= 1 commit + working tree clean
// 14. Phase 5 completion: no commits since implRetryBase → failed (not completed)
// 15. Phase 5 completion: dirty working tree → failed (not completed)
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement interactive.ts** — Key API:
```typescript
export interface InteractiveResult { status: 'completed' | 'failed'; }
export function runInteractivePhase(phase: 1 | 3 | 5, state: HarnessState, harnessDir: string): Promise<InteractiveResult>
```
See spec "Phase 완료 감지 > Interactive phase" and "실행 계약 (subprocess spawn)".

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 10: Gate Phase Runner

**Files:**
- Create: `src/phases/gate.ts`, `tests/phases/gate.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/phases/gate.test.ts — test cases:
// 1. Gate spawns node codexPath with stdin pipe
// 2. Verdict parsing: finds APPROVE after ## Verdict
// 3. Verdict parsing: finds REJECT after ## Verdict
// 4. Missing ## Verdict header → execution error
// 5. Timeout → SIGTERM → SIGKILL → gate error
// 6. Sidecar files: raw.txt + result.json written atomically
// 7. Resume: both sidecar files present → skip re-execution
// 8. Resume: partial sidecar → re-execute
// 9. Size-limit check → gate execution error
// 10. Lock childPid recorded on gate spawn, cleared after exit + group ESRCH
// 11. Gate error shutdown: SIGTERM → wait → SIGKILL → childPid cleared
// 12. Pre-run sidecar cleanup: stale gate-N-raw.txt/result.json/error.md deleted before execution
// 13. Post-success sidecar cleanup: raw.txt + result.json deleted after state advancement
// 14. gate-N-error.md deleted on successful retry or normal gate completion
// 15. Exit non-zero + valid verdict body → gate execution error (NOT reject) — exit code is authoritative
// 16. Exit 0 + REJECT token → normal reject path (not error)
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement gate.ts** — Key API:
```typescript
export type GateVerdict = 'APPROVE' | 'REJECT';
export interface GateOutcome { verdict: GateVerdict; comments: string; } | { error: string; }
export function runGatePhase(phase: 2 | 4 | 7, state: HarnessState, harnessDir: string): Promise<GateOutcome>
```
See spec "Automated phase (2, 4, 7) — Codex Gate" for full contract including stdin delivery, sidecar files, verdict parsing.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 11: Verify Phase Runner

**Files:**
- Create: `src/phases/verify.ts`, `tests/phases/verify.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/phases/verify.test.ts — test cases:
// 1. Runs harness-verify.sh with correct args
// 2. PASS: exitCode 0 + valid eval report → completed
// 3. FAIL: exitCode != 0, hasSummary true → feedback saved
// 4. ERROR: exitCode != 0, hasSummary false → error UI
// 5. ERROR: verify-result.json missing → always error
// 6. ERROR: verify-result.json parse failure → error
// 7. Timeout → SIGTERM → SIGKILL → error
// 8. verify-result.json deleted only after state advanced to completed
// 9. Phase 6 stays pending during preconditions, in_progress after spawn
// 10. Lock childPid recorded on verify spawn, cleared after exit + group ESRCH
// 11. Verify timeout: SIGTERM → wait → SIGKILL → childPid cleared
// 12. verify-error.md: written on Verify ERROR (stdout/stderr capture)
// 13. verify-error.md: deleted on Verify PASS
// 14. verify-error.md: overwritten on retry
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement verify.ts** — Key API:
```typescript
export type VerifyOutcome = { type: 'pass' } | { type: 'fail'; feedbackPath: string } | { type: 'error'; errorPath?: string };
export function runVerifyPhase(state: HarnessState, harnessDir: string): Promise<VerifyOutcome>
```
See spec "Automated phase (6) — harness-verify.sh" and "Phase 6 성공 조건 / FAIL / ERROR".

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 12: Prompt Assembler

**Files:**
- Create: `src/context/assembler.ts`, `src/context/prompts/phase-1.md`, `src/context/prompts/phase-3.md`, `src/context/prompts/phase-5.md`, `tests/context/assembler.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/context/assembler.test.ts — test cases:
// 1. Phase 1 prompt includes task path + phaseAttemptId sentinel instruction
// 2. Phase 1 prompt includes feedback path when present
// 3. Phase 3 prompt includes spec + decisions + checklist schema
// 4. Phase 5 prompt includes spec + plan + decisions + all feedbacks
// 5. Gate 2 prompt includes spec content inline
// 6. Gate 7 prompt includes diff (normal mode vs external-commit mode)
// 7. Gate 7 prompt with truncation when diff > 50KB (per-section truncation)
// 8. Gate 7 prompt with size-limit error when single file > 200KB
// 9. Gate 7 prompt with assembled total > 500KB → gate execution error
// 10. Phase 7 external commits summary section (evalCommit..HEAD log)
// 11. Phase 7 with implCommit==null + externalCommitsDetected → fallback diff + strong warning
// 12. Phase 7 metadata block: implementation range, eval commit, verifiedAtHead always present
// 13. Phase 7 with externalCommitsDetected: split diff (baseCommit..implCommit + evalCommit show)
// 14. Phase 7 external commit recheck updates state if newly detected
// 15. All gate prompts (2/4/7) include shared reviewer contract (APPROVE/REJECT rules, structured output format)
// 16. Gate prompt includes full reviewer contract: "APPROVE only if zero P0/P1" + "Every comment must cite a specific location" + exact section headers
// 17. Phase 1 prompt: instructs spec creation with "## Context & Decisions" section
// 18. Phase 1 prompt: instructs Decision Log creation with specified format
// 19. Phase 5 prompt: includes "commit changes before exit" instruction
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement assembler.ts + templates.ts** — Key API:
```typescript
export function assembleInteractivePrompt(phase: 1 | 3 | 5, state: HarnessState, harnessDir: string): string
export function assembleGatePrompt(phase: 2 | 4 | 7, state: HarnessState, harnessDir: string, cwd: string): string | { error: string }
```
See spec "Context 주입 전략" and "Gate phase 프롬프트 계약" for templates and size policies.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 13: UI Module

**Files:**
- Create: `src/ui.ts`

- [ ] **Step 1: Implement TTY prompt helpers**:
```typescript
export function promptChoice(message: string, choices: { key: string; label: string }[]): Promise<string>
export function printPhaseTransition(from: number, to: number, status: string): void
export function printWarning(msg: string): void
export function printError(msg: string): void
```
Uses `process.stdin` in raw mode for single-key selection (R/S/Q/C). No external dependency needed.

- [ ] **Step 2: Commit**

---

## Task 14: Signal Handler (SIGINT/SIGTERM)

**Files:**
- Create: `src/signal.ts`, `tests/signal.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/signal.test.ts — test cases:
// 1. registerSignalHandlers installs SIGINT + SIGTERM handlers
// 2. On signal: sends SIGTERM to child PGID → waits → SIGKILL if needed
// 3. On signal: clears childPid in lock after child group termination
// 4. On signal: saves pausedAtHead = git rev-parse HEAD
// 5. On signal during interactive phase → phase status = failed, run.status = in_progress
// 6. On signal during automated phase → phase status = error, pendingAction set
// 7. On signal: state.json atomic write (pendingAction included)
// 8. On signal: repo.lock + run.lock deleted after state write
// 9. On signal: process exits with code 130 (SIGINT convention)
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement signal.ts** — Key API:
```typescript
export function registerSignalHandlers(context: {
  harnessDir: string;
  runId: string;
  state: HarnessState;
  getChildPid: () => number | null;
  cwd: string;
}): void
```
See spec "사용자 인터럽트 처리 (SIGINT/SIGTERM)" for the 8-step shutdown sequence. Handler captures current phase type (interactive vs automated) to determine phase status and pendingAction. `pausedAtHead` is saved for every intentional exit (completed, paused, interrupted, error quit).

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 15: Root Discovery & Current-Run Pointer

**Files:**
- Create: `src/root.ts`, `tests/root.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/root.test.ts — test cases:
// 1. findHarnessRoot with git repo → git root/.harness
// 2. findHarnessRoot without git → upward scan for .harness/
// 3. findHarnessRoot with --root flag → use explicit path
// 4. findHarnessRoot no .harness/ found → error
// 5. getCurrentRun reads .harness/current-run file
// 6. getCurrentRun returns null when file missing
// 7. setCurrentRun writes runId to current-run file
// 8. resolveRunId: explicit arg → use it + update current-run
// 9. resolveRunId: no arg → read current-run
// 10. resolveRunId: no arg + no current-run → error with guidance
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement root.ts** — Key API:
```typescript
export function findHarnessRoot(explicitRoot?: string, cwd?: string): string
export function getCurrentRun(harnessDir: string): string | null
export function setCurrentRun(harnessDir: string, runId: string): void
export function resolveRunId(harnessDir: string, explicitRunId?: string): string
```
See spec "`.harness/` 루트 탐색 규칙" and "harness resume" error cases.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 16: Phase Lifecycle Runner (State Machine) [was Task 14]

**Files:**
- Create: `src/phases/runner.ts`, `tests/phases/runner.test.ts`

- [ ] **Step 1: Write failing tests** — core state transitions:
```typescript
// tests/phases/runner.test.ts — core state transitions:
// 1. Normal flow: Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → completed
// 2. Gate REJECT: retry < 3 → reopen previous interactive phase
// 3. Gate REJECT: retry >= 3 → escalation UI
// 4. Gate APPROVE → next phase
// 5. Verify PASS → Phase 7
// 6. Verify FAIL → Phase 5 reopen (verifyRetries tracking)
// 7. Escalation [C]ontinue / [S]kip / [Q]uit transitions
// 8. Auto mode: gate/verify limit exceeded → force pass
// 9. Phase 7 REJECT → Phase 5 reopen + Phase 6 pending (no eval report delete)
// 10. normalize_artifact_commit called after Phase 1/3 completion
// 11. Commit anchor updates (specCommit, planCommit, implCommit, evalCommit)
//
// Crash-safe pendingAction ordering (spec "복합 전이의 pendingAction 기록 순서"):
// 12. Gate REJECT: feedback save → pendingAction+state atomic write → spawn (not before)
// 13. Verify FAIL: feedback save → pendingAction+state atomic write → eval report delete → spawn
// 14. Gate error quit: error status + pendingAction in single atomic write
// 15. Verify error quit: error status + pendingAction in single atomic write
// 16. Escalation quit: paused status + pendingAction in single atomic write
// 17. Skip (all paths): pendingAction=skip_phase atomic write → side effects → state advance
//
// pausedAtHead persistence (all intentional exits):
// 18. Completed run: pausedAtHead = HEAD saved before lock release
// 19. Paused run (escalation/error quit): pausedAtHead saved
// 20. Interrupted run (SIGINT): pausedAtHead saved (delegated to signal handler)
// 21. Recoverable error exit: pausedAtHead saved
//
// Phase 6 skip paths (all use same flow):
// 22. Verify escalation [S]kip: synthetic report + cleanup + normalize + commit anchors
// 23. Auto-mode verify limit: same synthetic report path as manual skip
// 24. Direct harness skip: same flow
//
// Counter-reset edge cases (spec transition table):
// 25. verifyRetries reset to 0 on: Phase 7 reject, Phase 7 escalation [C]ontinue, Verify PASS, Phase 6 skip
// 26. gateRetries[N] reset on: escalation [C]ontinue for that gate
// 27. gateRetries[7] + verifyRetries both reset on Phase 7 reject → Phase 5 reopen
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement runner.ts** — Key API:
```typescript
export async function runPhaseLoop(state: HarnessState, harnessDir: string, cwd: string): Promise<void>
```
This is the core orchestrator. It reads `state.currentPhase` and `state.phases[N]`, executes the current phase via interactive/gate/verify runners, processes outcomes (approve/reject/pass/fail/error), updates state atomically, and advances to the next phase or handles escalation. See spec "이벤트별 상태 전이 (authoritative)" table for all transitions.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 17: Resume Algorithm [was Task 15]

**Files:**
- Modify: `src/phases/runner.ts` (add resume entry point)
- Create: `tests/commands/resume.test.ts`

- [ ] **Step 1: Write failing tests** — pendingAction replay (per-type):
```typescript
// tests/commands/resume.test.ts — pendingAction replay:
// 1. reopen_phase: fresh sentinel (phaseAttemptId match) → skip spawn, run completion pipeline
// 2. reopen_phase: stale/missing sentinel → delete old sentinel, spawn Claude
// 3. reopen_phase from Verify FAIL (sourcePhase=6): deletes eval report if present before spawn
// 4. reopen_phase: feedbackPaths missing → error with guidance
// 5. rerun_gate: phase already completed → clear pendingAction, advance
// 6. rerun_gate: phase not completed → re-execute gate
// 7. rerun_verify: phase 6 completed → clear pendingAction, advance to Phase 7
// 8. rerun_verify: phase 6 not completed → re-execute verify
// 9. show_escalation: displays gate escalation UI, second-stage preflight after user choice
// 10. show_verify_error: displays verify error UI with retry/quit
// 11. skip_phase: phase completed → clear pendingAction, advance
// 12. skip_phase: Phase 6 not completed → idempotent skip (synthetic report, normalize, evalCommit)
// 13. paused + null pendingAction → error message
```

- [ ] **Step 2: Write failing tests** — general resume paths:
```typescript
// tests/commands/resume.test.ts — general recovery:
// 14. Resume interactive in_progress + fresh sentinel → artifact validation + normalize + advance
// 15. Resume interactive in_progress + stale sentinel → reopen
// 16. Resume interactive failed + no sentinel → reopen
// 17. Resume gate in_progress + sidecar files → parse verdict
// 18. Resume gate in_progress + no sidecars → re-execute
// 19. Resume Phase 6 pending → run preconditions + verify
// 20. Resume Phase 6 in_progress + verify-result.json PASS → normalize retry
// 21. Resume Phase 6 in_progress + verify-result.json FAIL → verifyRetries++ + FAIL handler
// 22. Resume Phase 6 in_progress + no verify-result.json → Verify ERROR
// 23. Resume Phase 1/3 error + sentinel → artifact revalidation + normalize retry
// 24. Resume Phase 1/3 error + no sentinel → skip-path commit retry
// 25. Completed phase artifact validation (exists + valid + git-committed check)
// 26. Ancestry validation (specCommit, planCommit, implCommit, evalCommit)
// 27. External commit detection on resume (known-anchor exclusion)
// 28. repo.lock parse failure → manual recovery error
// 29. repo.lock.tmp recovery → liveness check → cleanup
// 30. Phase 6 completed + verify-result.json already deleted → proceed to Phase 7 (not Verify ERROR)
// 31. show_verify_error: retry → verify-phase preflight runs; preflight fail → re-display UI menu
// 32. show_escalation (gate): [C]ontinue → interactive-phase preflight before reopen
// 33. show_escalation (verify): distinct from gate — [C]ontinue reopens Phase 5, [S]kip takes synthetic Phase 6 path
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement resume logic in runner.ts** — Key API:
```typescript
export async function resumeRun(state: HarnessState, harnessDir: string, cwd: string): Promise<void>
```
See spec "Resume 동작" (steps 0-3) for the complete algorithm.

- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 18: Command — `harness run`

**Files:**
- Create: `src/commands/run.ts`, `tests/commands/run.test.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/commands/run.test.ts — test cases:
// 1. Creates all required directories: .harness/<runId>/, docs/specs/, docs/plans/, docs/process/evals/
// 2. Ensures .gitignore includes .harness/
// 3. Saves task.md with task description
// 4. Creates initial state.json
// 5. Sets baseCommit after .gitignore commit
// 6. Runs full preflight (all 10 items)
// 7. Staged changes blocked (even with --allow-dirty)
// 8. Unstaged changes blocked (without --allow-dirty)
// 9. Unstaged changes allowed (with --allow-dirty + warning)
// 10. Empty task string → error
// 11. Cleanup on failure before state.json (partial dir + locks deleted)
// 12. Preserve run on failure after state.json (runId printed, resume guidance)
// 13. .gitignore: pre-existing uncommitted .gitignore changes → error (not modified)
// 14. .gitignore: .harness/ already in .gitignore → no-op (no commit)
// 15. .gitignore: other staged files present → error before .gitignore modification
// 16. .gitignore: commit failure → error with "retry harness run" guidance
// 17. current-run: updated only after state.json + lock acquisition succeed
// 18. current-run: init failure before state.json → current-run unchanged (no broken pointer)
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement run.ts** — See spec "harness run" command and "harness run 초기화 실패 시 cleanup".
- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 19: Command — `harness resume`

**Files:**
- Create: `src/commands/resume.ts`, `tests/commands/resume-cmd.test.ts`

- [ ] **Step 1: Write failing tests** — command-level behavior:
```typescript
// tests/commands/resume-cmd.test.ts — test cases:
// 1. Explicit runId → resumes that run + updates current-run pointer
// 2. No runId → reads current-run pointer → resumes
// 3. No runId + no current-run → error: "No active run. Use 'harness run'..."
// 4. RunId not found (.harness/<runId>/ missing) → error
// 5. state.json missing in run dir → error: "Manual recovery required"
// 6. state.json corrupted (invalid JSON) → error: "corrupted"
// 7. Completed run → updates current-run pointer THEN error: "already completed, use jump"
// 8. Lock acquisition before state inspection
// 9. repo.lock parse failure → manual recovery error (before any state change)
// 10. Preflight: selects items based on pendingAction type or next phase type
// 11. codexPath: uses saved path, re-discovers if missing, errors if not found
// 12. Ancestry checks: specCommit, planCommit, implCommit, evalCommit validated
// 13. External commit detection: warning emitted + state updated
// 14. --allow-dirty accepted but no-op (resume doesn't check working tree)
```

- [ ] **Step 2: Run tests — verify they fail**
- [ ] **Step 3: Implement resume.ts** — resolves runId, validates state, acquires lock, runs preflight, ancestry checks, external commit detection, then delegates to `resumeRun()`.
- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 20: Commands — `harness skip` & `harness jump`

**Files:**
- Create: `src/commands/skip.ts`, `src/commands/jump.ts`, `tests/commands/skip.test.ts`, `tests/commands/jump.test.ts`

- [ ] **Step 1: Write failing tests for skip**:
```typescript
// Command surface:
// 1. Skip on paused run → error: "Use 'harness resume' first"
// 2. Skip on completed run → error: "Use 'harness jump N'"
// 3. Skip clears stale pendingAction/pauseReason before proceeding
//
// Required-input validation (per phase):
// 4. Phase 1 skip: spec + decisions must exist + non-empty
// 5. Phase 3 skip: plan + checklist must exist + valid schema
// 6. Phase 5 skip: working tree clean + no impl commits (implRetryBase..HEAD empty)
// 7. Phase 6 skip: working tree clean + verify-feedback.md deleted before synthetic report
// 8. Gate phases (2,4,7): required-input files exist (spec/plan/eval report)
//
// Phase-type preflight before state mutation:
// 9. Skip determines next phase type → runs that phase's preflight BEFORE any state change
// 10. Phase 7 skip: terminal completion preflight (git + platform only)
// 11. Preflight failure → no state mutation, error with guidance
//
// Crash-safe ordering:
// 12. pendingAction = skip_phase written atomically before side effects
// 13. Phase 6 skip: synthetic eval report + normalize_artifact_commit + evalCommit/verifiedAtHead update
// 14. Phase 6 skip via Verify escalation [S]kip: same path as direct skip
// 15. Phase 6 skip via auto-mode verify limit: same path as direct skip
// 16. Phase 1 skip: normalize_artifact_commit runs + specCommit updated
// 17. Phase 3 skip: normalize_artifact_commit runs + planCommit updated
// 18. Phase 6 synthetic report: validates format (header, related spec/plan, results table, ## Summary)
```

- [ ] **Step 2: Write failing tests for jump**:
```typescript
// 1. Backward jump resets phases[M>=N] to pending
// 2. Jump clears commit anchors (specCommit/planCommit/implCommit/evalCommit)
// 3. Jump clears sidecar files, sentinels, feedback
// 4. Jump from completed run works (currentPhase=8 → N)
// 5. Forward jump rejected
// 6. Target phase preflight runs before state mutation
// 7. Ancestry validation before jump
// 8. External commit detection on jump (same algorithm as resume)
// 9. Jump with external commits → externalCommitsDetected=true persisted + warning
// 10. Jump from completed run (currentPhase=8) → allowed for any N<8
//
// Full reset matrix (spec "Jump 초기화 규칙"):
// 11. gateRetries[M] → 0 for all gate phases M >= N
// 12. verifyRetries → 0 when N <= 6
// 13. pendingAction → null (always)
// 14. pauseReason → null (always)
// 15. run.status → in_progress (always, including from paused/completed)
// 16. implRetryBase → baseCommit when N <= 5
// 17. phaseOpenedAt[M] → null for M >= N
// 18. phaseAttemptId[M] → null for M >= N
// 19. checklist.json deleted when N <= 3
// 20. verify-result.json / verify-feedback.md / verify-error.md deleted when N <= 6
// 21. gate-M-raw.txt / gate-M-result.json / gate-M-error.md / gate-M-feedback.md deleted for M >= N
//
// Command-surface error cases (shared by skip and jump):
// 22. No current-run pointer → error with guidance
// 23. Target run directory missing → error
// 24. state.json missing or corrupt → error
// 25. Lock acquisition: skip/jump acquire repo.lock + run.lock before state inspection
// 26. Lock: stale lock detected → recovered before proceeding
// 27. Lock: active lock detected → error, no mutation
// 28. Lock: released on all exit paths (success, error, signal)
//
// Immediate execution after mutation:
// 29. jump N: after state reset, immediately starts phase N execution (no separate resume needed)
// 30. skip: after skip side effects, immediately advances to next phase (or terminal completion)
// 31. skip Phase 7: terminal completion, run.status=completed, no phase execution
```

- [ ] **Step 3: Run tests — verify they fail**
- [ ] **Step 4: Implement skip.ts and jump.ts** — See spec "Skip 정책", "Jump 초기화 규칙".
- [ ] **Step 5: Run tests — verify they pass**
- [ ] **Step 6: Commit**

---

## Task 21: Commands — `harness status` & `harness list`

**Files:**
- Create: `src/commands/status.ts`, `src/commands/list.ts`

- [ ] **Step 1: Write failing tests**:
```typescript
// tests/commands/status-list.test.ts — test cases:
// 1. status: prints phase status, artifacts, retries for current run
// 2. status: no current-run → error: "No active run. Use 'harness list'"
// 3. status: current-run points to missing state.json → error
// 4. status: works without TTY (non-interactive output)
// 5. list: shows all runs with status in table format
// 6. list: works without git repo (non-git context)
// 7. list: works without TTY
// 8. list: empty .harness/ → "No runs found"
// 9. Both commands: platform check rejects win32 (shared with all commands)
```
- [ ] **Step 2: Implement status** — reads current-run → state.json → prints phase status, artifacts, retries.
- [ ] **Step 3: Implement list** — scans .harness/ for all run directories → prints runId + status table.
- [ ] **Step 4: Run tests — verify they pass**
- [ ] **Step 5: Commit**

---

## Task 22: CLI Entry Point & Packaging

**Files:**
- Create: `bin/harness.ts`

- [ ] **Step 1: Wire up Commander.js**:
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
const program = new Command();
program.name('harness').version('0.1.0');
program.command('run <task>').option('--allow-dirty').option('--auto').action(runCommand);
program.command('resume [runId]').option('--allow-dirty').action(resumeCommand);
program.command('status').action(statusCommand);
program.command('list').action(listCommand);
program.command('skip').action(skipCommand);
program.command('jump <phase>').action(jumpCommand);
program.parse();
```

- [ ] **Step 2: Build and test CLI boots**:
```bash
pnpm run build
node dist/bin/harness.js --help
```

- [ ] **Step 3: Add global flag --root** (delegates to `findHarnessRoot()` from root.ts)
- [ ] **Step 4: Commit**

---

## Task 23: Integration Tests

**Files:**
- Create: `tests/integration/lifecycle.test.ts`

- [ ] **Step 1: Write integration tests** in temp git repos:
```typescript
// tests/integration/lifecycle.test.ts — test cases:
// 1. Full happy path: run → (mock) Phase 1 complete → gate approve → ... → completed
//    (uses mock claude/codex binaries that write expected artifacts + sentinels)
// 2. Stale repo.lock recovery: create stale lock → resume succeeds
// 3. Skip + jump: run → skip Phase 1 (with pre-existing artifacts) → jump 1 → restart
// 4. Gate reject → Phase reopen with feedback file
// 5. Verify fail → Phase 5 reopen with verify-feedback.md
// 6. Interrupted run recovery: write state with pendingAction → resume recovers
// 7. resume on completed run → error message
// 8. harness status + harness list output format
// 9. --allow-dirty: unstaged changes allowed, staged blocked
// 10. Phase 6 preconditions: eval report cleanup before verify
// 11. SIGINT during interactive phase → state saved + resume recovers
// 12. SIGINT during gate phase → pendingAction set + resume re-executes gate
// 13. Phase 7 with externalCommitsDetected=true → diff uses split ranges + warning
// 14. Orphaned run.lock without repo.lock → cleaned up on resume
// 15. Paused state recovery: gate-escalation quit → resume → escalation UI re-displayed
// 16. Paused state recovery: verify-error quit → resume → error UI re-displayed + second-stage preflight
// 17. Jump with external commits in history → externalCommitsDetected persisted
// 18. --root flag: list/status/resume use explicit root instead of auto-discovery
```

- [ ] **Step 2: Create mock binaries** (`tests/helpers/mock-claude.sh`, `tests/helpers/mock-codex.mjs`, `tests/helpers/mock-verify.sh`) that write expected artifacts and exit codes for controlled testing. `mock-verify.sh` supports configurable exit codes and `## Summary` presence to test PASS/FAIL/ERROR paths deterministically.

- [ ] **Step 3: Run integration tests**:
```bash
pnpm test tests/integration/
```

- [ ] **Step 4: Commit**

---

## Eval Checklist

The following verification commands will be used for automated evaluation (Phase 6):

```json
{
  "checks": [
    { "name": "Type Check", "command": "pnpm run lint" },
    { "name": "Unit Tests", "command": "pnpm test -- --exclude tests/integration/" },
    { "name": "Integration Tests", "command": "pnpm test tests/integration/" },
    { "name": "Build", "command": "pnpm run build" },
    { "name": "CLI Help", "command": "node dist/bin/harness.js --help" },
    { "name": "CLI Version", "command": "node dist/bin/harness.js --version" }
  ]
}
```

---

## Task Dependencies

```
Task 1 (scaffolding)
  ├── Task 2 (types + config)
  │   ├── Task 3 (state)
  │   ├── Task 4 (git)
  │   ├── Task 5 (process)
  │   └── Task 7 (preflight) ← depends on 4, 5
  ├── Task 6 (lock) ← depends on 3, 5
  ├── Task 8 (artifact) ← depends on 4
  ├── Task 9 (interactive) ← depends on 5, 3, 6, 12
  ├── Task 10 (gate) ← depends on 5, 3, 6, 12
  ├── Task 11 (verify) ← depends on 5, 3, 6, 8
  ├── Task 12 (assembler) ← depends on 2, 4
  ├── Task 13 (UI) ← no deps
  ├── Task 14 (signal) ← depends on 5, 3, 6
  ├── Task 15 (root) ← depends on 4
  ├── Task 16 (runner) ← depends on 9, 10, 11, 8, 13, 14
  ├── Task 17 (resume) ← depends on 16, 6, 15
  ├── Task 18 (cmd: run) ← depends on 16, 6, 7, 15
  ├── Task 19 (cmd: resume) ← depends on 17, 15, 4, 7
  ├── Task 20 (cmd: skip/jump) ← depends on 16, 15, 4, 7
  ├── Task 21 (cmd: status/list) ← depends on 3, 15, 7
  ├── Task 22 (CLI entry) ← depends on 18-21
  └── Task 23 (integration tests) ← depends on 22
```

**Parallelizable groups:**
- Group A (no deps after Task 2): Tasks 3, 4, 5, 13
- Group B (after Group A): Tasks 6, 7, 8, 12, 14, 15
- Group C (after Group B — needs lock from Group B): Tasks 9, 10, 11
- Group D (after Group C): Task 16 (runner)
- Group E (after Task 16): Tasks 17, 18, 19, 20, 21
- Group F (after Group E): Task 22 (CLI entry)
- Group G (after Task 22): Task 23 (integration tests)
