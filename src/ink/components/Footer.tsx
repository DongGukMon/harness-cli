import React from 'react';
import { Box, Text } from 'ink';
import type { FooterSummary } from '../../metrics/footer-aggregator.js';
import { formatFooter } from '../../metrics/footer-aggregator.js';
import { truncateEnd } from '../theme.js';

interface Props {
  summary: FooterSummary | null;
  columns: number;
}

export function Footer({ summary, columns }: Props): React.ReactElement | null {
  if (summary === null) return null;
  const line = formatFooter(summary, columns);
  if (!line && !summary.tmuxSession) return null;
  const attach = summary.tmuxSession ? `attach: tmux attach -t ${summary.tmuxSession}` : null;
  return (
    <Box flexDirection="column">
      {line && <Text dimColor>{line}</Text>}
      {attach && (
        <Text dimColor>{truncateEnd(attach, Math.max(20, columns))}</Text>
      )}
    </Box>
  );
}
