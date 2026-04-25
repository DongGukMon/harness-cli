import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { subscribe, getSnapshot } from './store.js';
import type { StoreSnapshot } from './store.js';
import { useTerminalSize } from './theme.js';
import { Header } from './components/Header.js';
import { PhaseTimeline } from './components/PhaseTimeline.js';
import { CurrentPhase } from './components/CurrentPhase.js';
import { GateVerdict } from './components/GateVerdict.js';
import { ActionMenu } from './components/ActionMenu.js';
import { Footer } from './components/Footer.js';

export function App(): React.ReactElement {
  const [snap, setSnap] = useState<StoreSnapshot | null>(getSnapshot);

  useEffect(() => {
    return subscribe(setSnap);
  }, []);

  const { columns } = useTerminalSize();

  if (snap === null) {
    return <Text dimColor>Initializing…</Text>;
  }

  const { state, callsite, footerSummary } = snap;
  return (
    <Box flexDirection="column">
      <Header state={state} elapsedMs={footerSummary?.phaseRunningElapsedMs ?? null} columns={columns} />
      <Box marginTop={1}>
        <Text dimColor>Progress</Text>
      </Box>
      <PhaseTimeline state={state} columns={columns} />
      <Box marginTop={1}>
        <CurrentPhase state={state} columns={columns} />
      </Box>
      <GateVerdict state={state} />
      <ActionMenu state={state} callsite={callsite} />
      {footerSummary !== null && (
        <Box marginTop={1}>
          <Footer summary={footerSummary} columns={columns} />
        </Box>
      )}
    </Box>
  );
}
