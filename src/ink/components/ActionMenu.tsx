import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState, RenderCallsite } from '../../types.js';
import { COLORS } from '../theme.js';

interface Props {
  state: HarnessState;
  callsite: RenderCallsite | undefined;
}

export function ActionMenu({ state: _state, callsite }: Props): React.ReactElement {
  const prominent = callsite === 'terminal-failed';
  if (!prominent) {
    return (
      <Box>
        <Text dimColor>  [R] Resume  [J] Jump  [Q] Quit</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text>  </Text>
      <Text bold color={COLORS.ok}>[R]</Text>
      <Text> Resume  </Text>
      <Text bold color={COLORS.accent}>[J]</Text>
      <Text> Jump  </Text>
      <Text bold color={COLORS.fail}>[Q]</Text>
      <Text> Quit</Text>
    </Box>
  );
}
