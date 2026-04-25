import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState, RenderCallsite } from '../../types.js';
import { COLORS } from '../theme.js';

interface Props {
  state: HarnessState;
  callsite: RenderCallsite | undefined;
}

export function ActionMenu({ state, callsite }: Props): React.ReactElement {
  const prominent = callsite === 'terminal-failed';
  if (!prominent) {
    if (callsite === 'terminal-complete' || state.status === 'completed') {
      return (
        <Box>
          <Text dimColor>Status </Text>
          <Text>Run complete. Press Ctrl+C to exit.</Text>
        </Box>
      );
    }

    const phaseStatus = state.phases[String(state.currentPhase)];
    if (phaseStatus === 'in_progress') {
      return (
        <Box>
          <Text dimColor>Status </Text>
          <Text>Waiting for phase completion.</Text>
        </Box>
      );
    }

    if (phaseStatus === 'failed' || phaseStatus === 'error') {
      return (
        <Box>
          <Text dimColor>Status </Text>
          <Text>Phase stopped. Terminal actions will appear below.</Text>
        </Box>
      );
    }

    return (
      <Box>
        <Text dimColor>Status </Text>
        <Text>Starting phase…</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text dimColor>Actions </Text>
      <Text bold color={COLORS.ok}>[R]</Text>
      <Text> Resume  </Text>
      <Text bold color={COLORS.accent}>[J]</Text>
      <Text> Jump  </Text>
      <Text bold color={COLORS.fail}>[Q]</Text>
      <Text> Quit</Text>
    </Box>
  );
}
