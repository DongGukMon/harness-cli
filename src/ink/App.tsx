import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { subscribe, getSnapshot } from './store.js';
import type { StoreSnapshot } from './store.js';
import { useTerminalSize, GLYPHS } from './theme.js';
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
  const separator = GLYPHS.bullet.repeat(Math.max(16, Math.min(64, columns - 2)));

  return (
    <Box flexDirection="column">
      <Header state={state} elapsedMs={footerSummary?.phaseRunningElapsedMs ?? null} />
      <Text dimColor>{separator}</Text>
      <PhaseTimeline state={state} columns={columns} />
      <Text dimColor>{separator}</Text>
      <CurrentPhase state={state} />
      <GateVerdict state={state} />
      <ActionMenu state={state} callsite={callsite} />
      {footerSummary !== null && (
        <>
          <Text dimColor>{separator}</Text>
          <Footer summary={footerSummary} columns={columns} />
        </>
      )}
    </Box>
  );
}
