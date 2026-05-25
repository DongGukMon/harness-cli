import React from 'react';
import { Box, Text } from 'ink';
import type { DeferredRequirement, HarnessState } from '../../types.js';
import { COLORS, truncateEnd } from '../theme.js';
import { getPresetById } from '../../config.js';
import { phaseLabel } from '../phase-labels.js';
import type { WorkerLiveness } from '../store.js';

interface Props {
  state: HarnessState;
  columns?: number;
  /**
   * Workspace-pane worker liveness, computed once at terminal-failed entry
   * (#116 B1). Rendered only when the current phase is in 'failed' or 'error'
   * state — outside that window the field is undefined and no indicator
   * appears. Lets the operator see whether `[R]` will kill an in-progress
   * worker before pressing it.
   */
  workerLiveness?: WorkerLiveness;
}

export function CurrentPhase({ state, columns = 80, workerLiveness }: Props): React.ReactElement {
  const p = state.currentPhase;
  const label = phaseLabel(String(p), state.flow);
  const status = state.phases[String(p)] ?? 'pending';
  const statusColor = status === 'completed' ? COLORS.ok
    : status === 'in_progress' ? COLORS.inProgress
    : status === 'failed' || status === 'error' ? COLORS.fail
    : undefined;

  const presetId = state.phasePresets?.[String(p)];
  const preset = presetId ? getPresetById(presetId) : null;

  const retries = state.gateRetries[String(p)] ?? 0;
  const presetText = preset ? `${preset.model} (${preset.runner}/${preset.effort})` : null;
  const modelBudget = Math.max(18, columns - 8);
  const phaseText = columns < 60 ? `P${p}` : `Phase ${p}`;
  const retryText = retries > 0 ? ` (retry ${retries})` : '';
  const summaryFixedWidth = 'Current '.length + phaseText.length + ': '.length + ' - '.length + status.length + retryText.length;
  const summaryLabel = truncateEnd(label, Math.max(4, columns - summaryFixedWidth));
  const waitingText = truncateEnd('Waiting for phase completion.', Math.max(20, columns));

  const deferredIds = Object.values(state.deferredRequirements ?? {})
    .flat()
    .filter((d): d is DeferredRequirement => Boolean(d?.requirementId))
    .map((d) => d.requirementId);
  const deferredLine = deferredIds.length > 0
    ? truncateEnd(`⚠ Deferred: ${deferredIds.join(', ')}`, Math.max(20, columns))
    : null;

  // Issue #116 B1: render a worker-liveness signal on terminal-failed so the
  // operator can tell at a glance whether pressing `[R] Resume` will kill an
  // in-progress workspace worker (Claude/Codex TUI + any child like
  // `codex-companion task`). Computed once by `enterFailedTerminalState`;
  // the field is undefined outside that window so this line stays hidden.
  const showLiveness = workerLiveness !== undefined && (status === 'failed' || status === 'error');
  const livenessLine = showLiveness
    ? (workerLiveness === 'alive'
        ? '⚠ Worker alive — [R] will kill the in-progress workspace worker'
        : '✓ Worker dead — [R] respawns the pane (no in-progress work to lose)')
    : null;
  const livenessColor = workerLiveness === 'alive' ? COLORS.fail : COLORS.ok;

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>Current </Text>
        <Text bold>{phaseText}</Text>
        <Text>: {summaryLabel} - </Text>
        <Text color={statusColor}>{status}</Text>
        {retries > 0 && <Text dimColor>{retryText}</Text>}
      </Box>
      {presetText && (
        <Text dimColor>Model {truncateEnd(presetText, modelBudget)}</Text>
      )}
      {deferredLine && (
        <Text color={COLORS.inProgress}>{deferredLine}</Text>
      )}
      {status === 'in_progress' && (
        <Text dimColor>{waitingText}</Text>
      )}
      {livenessLine && (
        <Text color={livenessColor}>{truncateEnd(livenessLine, Math.max(20, columns))}</Text>
      )}
    </Box>
  );
}
