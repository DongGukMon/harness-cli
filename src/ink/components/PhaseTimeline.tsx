import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState, PhaseStatus } from '../../types.js';
import { COLORS, GLYPHS } from '../theme.js';
import { getSlots } from '../phase-labels.js';

function statusIcon(status: PhaseStatus): string {
  switch (status) {
    case 'completed': return GLYPHS.ok;
    case 'in_progress': return GLYPHS.inProgress;
    case 'failed':
    case 'error': return GLYPHS.fail;
    case 'skipped': return GLYPHS.skipped;
    default: return GLYPHS.pending;
  }
}

function statusColor(status: PhaseStatus): string | undefined {
  switch (status) {
    case 'completed': return COLORS.ok;
    case 'in_progress': return COLORS.inProgress;
    case 'failed':
    case 'error': return COLORS.fail;
    default: return undefined;
  }
}

interface Props {
  state: HarnessState;
  columns?: number;
}

export function PhaseTimeline({ state, columns = 80 }: Props): React.ReactElement {
  const slots = getSlots(state.flow);
  const narrow = columns < 60;

  return (
    <Box flexWrap="wrap">
      {slots.map((slot, idx) => {
        const status = state.phases[slot.key] ?? 'pending';
        const icon = statusIcon(status);
        const color = statusColor(status);
        const isCurrent = String(state.currentPhase) === slot.key;
        const label = narrow ? `P${slot.key}` : slot.label;

        return (
          <Box key={slot.key} marginRight={1}>
            <Text>[</Text>
            <Text color={color}>{icon}</Text>
            <Text>]</Text>
            <Text bold={isCurrent} dimColor={!isCurrent && status === 'pending'}>
              {' '}{label}
            </Text>
            {idx < slots.length - 1 && !narrow && <Text dimColor>  </Text>}
          </Box>
        );
      })}
    </Box>
  );
}
