import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { emitRetroHook } from '../../src/commands/inner.js';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-hook-test-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const BASE = 1746612000000;
const MINIMAL_EVENTS =
  JSON.stringify({ v:1, ts:BASE, runId:'r0', event:'session_start', task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }) + '\n' +
  JSON.stringify({ v:1, ts:BASE+100, runId:'r0', event:'session_end', status:'completed', totalWallMs:100 }) + '\n';

describe('emitRetroHook', () => {
  it('no-op when logger.getEventsPath() returns null', async () => {
    const logger = { getEventsPath: () => null };
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await emitRetroHook(logger, tmpDir, 'run-null');
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, 'run-null', 'retrospective.md'))).toBe(false);
    stderrSpy.mockRestore();
  });

  it('writes <harnessDir>/<runId>/retrospective.md on valid events.jsonl', async () => {
    const eventsFile = path.join(tmpDir, 'events.jsonl');
    fs.writeFileSync(eventsFile, MINIMAL_EVENTS);
    const logger = { getEventsPath: () => eventsFile };
    await emitRetroHook(logger, tmpDir, 'run-ok');
    expect(fs.existsSync(path.join(tmpDir, 'run-ok', 'retrospective.md'))).toBe(true);
  });

  it('warns once to stderr and does NOT rethrow when events.jsonl is missing', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = { getEventsPath: () => path.join(tmpDir, 'nonexistent.jsonl') };
    await expect(emitRetroHook(logger, tmpDir, 'run-err')).resolves.toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[retro] failed to generate retrospective:'));
    stderrSpy.mockRestore();
  });
});
