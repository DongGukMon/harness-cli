import React from 'react';
import { Box, Text } from 'ink';
import type { FooterSummary } from '../../metrics/footer-aggregator.js';
import { formatFooter } from '../../metrics/footer-aggregator.js';

interface Props {
  summary: FooterSummary | null;
  columns: number;
}

export function Footer({ summary, columns }: Props): React.ReactElement | null {
  if (summary === null) return null;
  const line = formatFooter(summary, columns);
  if (!line) return null;
  return (
    <Box>
      <Text dimColor>{line}</Text>
    </Box>
  );
}
