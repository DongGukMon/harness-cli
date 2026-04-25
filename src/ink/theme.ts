import { useStdout } from 'ink';

export const COLORS = {
  ok: 'green',
  inProgress: 'yellow',
  fail: 'red',
  pending: 'gray' as string | undefined,
  accent: 'cyan',
  dim: 'gray' as string | undefined,
} as const;

export const GLYPHS = {
  ok: '✓',
  fail: '✗',
  inProgress: '▶',
  pending: ' ',
  skipped: '—',
  bullet: '·',
} as const;

export function truncateEnd(value: string, maxColumns: number): string {
  if (maxColumns <= 0) return '';
  if (value.length <= maxColumns) return value;
  if (maxColumns === 1) return '…';
  return `${value.slice(0, maxColumns - 1)}…`;
}

export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  return {
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  };
}
