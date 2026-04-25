import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState } from '../../types.js';
import { COLORS, truncateEnd } from '../theme.js';
import { getPresetById } from '../../config.js';
import { phaseLabel } from '../phase-labels.js';

interface Props {
  state: HarnessState;
  columns?: number;
}

export function CurrentPhase({ state, columns = 80 }: Props): React.ReactElement {
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
      {status === 'in_progress' && (
        <Text dimColor>{waitingText}</Text>
      )}
    </Box>
  );
}
