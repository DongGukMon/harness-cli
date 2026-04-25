import React from 'react';
import { Box, Text } from 'ink';
import type { HarnessState } from '../../types.js';
import { COLORS } from '../theme.js';

interface Props {
  state: HarnessState;
}

const GATE_PHASES = ['2', '4', '7'] as const;
type GatePhaseKey = typeof GATE_PHASES[number];

export function GateVerdict({ state }: Props): React.ReactElement | null {
  let lastPhase: GatePhaseKey | null = null;
  let verdict: 'APPROVED' | 'REJECTED' | null = null;

  for (const p of GATE_PHASES) {
    const status = state.phases[p];
    if (status === 'completed') { lastPhase = p; verdict = 'APPROVED'; }
    else if (status === 'failed') { lastPhase = p; verdict = 'REJECTED'; }
  }

  if (lastPhase === null || verdict === null) return null;

  const color = verdict === 'APPROVED' ? COLORS.ok : COLORS.fail;
  const retries = state.gateRetries[lastPhase] ?? 0;
  const runner = state.phaseCodexSessions[lastPhase]?.runner ?? null;

  return (
    <Box>
      <Text dimColor>Outcome </Text>
      <Text>Gate P{lastPhase}: </Text>
      <Text color={color}>{verdict}</Text>
      {runner && <Text dimColor> [{runner}]</Text>}
      {retries > 0 && <Text dimColor> (retry {retries})</Text>}
    </Box>
  );
}
