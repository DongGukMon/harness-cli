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

export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  return {
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  };
}
