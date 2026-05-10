import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState, RenderCallsite } from '../../types.js';
import { COLORS } from '../theme.js';

interface Props {
  state: HarnessState;
  callsite: RenderCallsite | undefined;
}

export function ActionMenu({ state, callsite }: Props): React.ReactElement {
  // Issue #98: when promptChoice opens for gate / verify retry-limit escalation
  // the harness-inner main loop is awaiting `inputManager.waitForKey(['c','s','q'])`.
  // Ink stays mounted on the same TTY, so a stderr `process.stderr.write` of the
  // prompt is clobbered by the next Ink render — the wedge looks like a hang
  // because the user can't see what keys to press. Fix: render the prompt as a
  // first-class action menu when the dispatcher passes the matching callsite.
  if (callsite === 'gate-escalation-pending') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={COLORS.fail}>Gate retry limit reached. </Text>
          <Text dimColor>Pick an action below:</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Actions </Text>
          <Text bold color={COLORS.ok}>[C]</Text>
          <Text> Continue (reset retries, reopen)  </Text>
          <Text bold color={COLORS.accent}>[S]</Text>
          <Text> Skip (force-pass)  </Text>
          <Text bold color={COLORS.fail}>[Q]</Text>
          <Text> Quit (pause)</Text>
        </Box>
      </Box>
    );
  }
  if (callsite === 'verify-escalation-pending') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={COLORS.fail}>Verify retry limit reached. </Text>
          <Text dimColor>Pick an action below:</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Actions </Text>
          <Text bold color={COLORS.ok}>[C]</Text>
          <Text> Continue (reset, reopen P5)  </Text>
          <Text bold color={COLORS.accent}>[S]</Text>
          <Text> Skip (force-pass)  </Text>
          <Text bold color={COLORS.fail}>[Q]</Text>
          <Text> Quit (pause)</Text>
        </Box>
      </Box>
    );
  }
  if (callsite === 'gate-error-pending') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={COLORS.fail}>Gate error. </Text>
          <Text dimColor>Pick an action below:</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Actions </Text>
          <Text bold color={COLORS.ok}>[R]</Text>
          <Text> Retry  </Text>
          <Text bold color={COLORS.accent}>[S]</Text>
          <Text> Skip (force-pass)  </Text>
          <Text bold color={COLORS.fail}>[Q]</Text>
          <Text> Quit (pause)</Text>
        </Box>
      </Box>
    );
  }
  if (callsite === 'verify-error-pending') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color={COLORS.fail}>Verify error. </Text>
          <Text dimColor>Pick an action below:</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Actions </Text>
          <Text bold color={COLORS.ok}>[R]</Text>
          <Text> Retry  </Text>
          <Text bold color={COLORS.fail}>[Q]</Text>
          <Text> Quit (pause)</Text>
        </Box>
      </Box>
    );
  }

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
