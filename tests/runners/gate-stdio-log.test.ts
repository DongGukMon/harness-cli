import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { persistGateRunnerStdio } from '../../src/runners/gate-stdio-log.js';

describe('persistGateRunnerStdio (#114 PR #4)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-stdio-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes gate-<N>-runner.stdio.log with stdout + stderr sections', () => {
    persistGateRunnerStdio(tmpDir, 2, 'stdout body line 1\nline 2', 'stderr body');

    const logPath = path.join(tmpDir, 'gate-2-runner.stdio.log');
    expect(fs.existsSync(logPath)).toBe(true);
    const body = fs.readFileSync(logPath, 'utf-8');
    expect(body).toContain('===== STDOUT =====');
    expect(body).toContain('===== STDERR =====');
    expect(body).toContain('stdout body line 1\nline 2');
    expect(body).toContain('stderr body');
    // stdout section appears before stderr section
    expect(body.indexOf('===== STDOUT =====')).toBeLessThan(body.indexOf('===== STDERR ====='));
  });

  it('writes file even when stdout and stderr are empty (presence-of-attempt signal)', () => {
    persistGateRunnerStdio(tmpDir, 4, '', '');

    const logPath = path.join(tmpDir, 'gate-4-runner.stdio.log');
    expect(fs.existsSync(logPath)).toBe(true);
    const body = fs.readFileSync(logPath, 'utf-8');
    expect(body).toContain('===== STDOUT =====');
    expect(body).toContain('===== STDERR =====');
  });

  it('overwrites prior content on retry (last retry wins, matches gate-N-raw.txt convention)', () => {
    persistGateRunnerStdio(tmpDir, 7, 'first attempt stdout', 'first stderr');
    persistGateRunnerStdio(tmpDir, 7, 'second attempt stdout', 'second stderr');

    const logPath = path.join(tmpDir, 'gate-7-runner.stdio.log');
    const body = fs.readFileSync(logPath, 'utf-8');
    expect(body).toContain('second attempt stdout');
    expect(body).toContain('second stderr');
    expect(body).not.toContain('first attempt stdout');
  });

  it('best-effort: throws no exception when write fails (e.g. parent dir missing)', () => {
    const missingDir = path.join(tmpDir, 'does-not-exist');
    expect(() => persistGateRunnerStdio(missingDir, 2, 'x', 'y')).not.toThrow();
  });
});
