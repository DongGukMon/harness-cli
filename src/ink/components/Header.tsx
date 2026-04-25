import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState } from '../../types.js';
import { COLORS, GLYPHS, truncateEnd } from '../theme.js';

interface Props {
  state: HarnessState;
  elapsedMs?: number | null;
  columns?: number;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export function Header({ state, elapsedMs, columns = 80 }: Props): React.ReactElement {
  const id = state.runId;
  const runLabelBudget = Math.max(12, Math.min(36, columns - 12));
  const runIdShort = truncateEnd(id, runLabelBudget);
  const badge = state.flow === 'light' ? '[light]' : '[full]';
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={COLORS.ok}>{GLYPHS.inProgress} </Text>
        <Text bold>Harness Control Panel </Text>
        <Text color={COLORS.accent}>{badge}</Text>
        {elapsedMs != null && <Text dimColor> · {fmtMs(elapsedMs)}</Text>}
      </Box>
      <Text dimColor>Run {runIdShort}</Text>
    </Box>
  );
}
