import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState } from '../../types.js';
import { COLORS } from '../theme.js';
import { getPresetById } from '../../config.js';
import { phaseLabel } from '../phase-labels.js';

interface Props {
  state: HarnessState;
}

export function CurrentPhase({ state }: Props): React.ReactElement {
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

  return (
    <Box flexDirection="column">
      <Box>
        <Text>  Phase </Text>
        <Text bold>{p}</Text>
        <Text>: {label} — </Text>
        <Text color={statusColor}>{status}</Text>
        {retries > 0 && <Text dimColor> (retry {retries})</Text>}
      </Box>
      {preset && (
        <Text dimColor>  {preset.model} ({preset.runner}/{preset.effort})</Text>
      )}
    </Box>
  );
}
