import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';
import {
  getProcessStartTime,
  isPidAlive,
  isProcessGroupAlive,
} from '../src/process.js';

describe('getProcessStartTime', () => {
  it('returns a number for the current process', () => {
    const result = getProcessStartTime(process.pid);
    expect(typeof result).toBe('number');
    expect(result).not.toBeNull();
    // Should be a reasonable epoch seconds value (after year 2000)
    expect(result as number).toBeGreaterThan(946684800);
  });

  it('returns null for a nonexistent PID', () => {
    const result = getProcessStartTime(99999);
    expect(result).toBeNull();
  });
});

describe('isPidAlive', () => {
  it('returns true for the current process', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a nonexistent PID', () => {
    expect(isPidAlive(99999)).toBe(false);
  });
});

describe('isProcessGroupAlive', () => {
  it('returns true for the current process group', () => {
    // Get the actual PGID for the current process
    const pgidStr = execSync(`ps -o pgid= -p ${process.pid}`, { encoding: 'utf8' }).trim();
    const pgid = parseInt(pgidStr, 10);
    expect(isProcessGroupAlive(pgid)).toBe(true);
  });

  it('returns false for a nonexistent PGID', () => {
    expect(isProcessGroupAlive(99999)).toBe(false);
  });
});
