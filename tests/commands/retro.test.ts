import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { retroCommand } from '../../src/commands/retro.js';
import { computeRepoKey } from '../../src/logger.js';

const BASE = 1746612000000;
const MINIMAL_EVENTS =
  JSON.stringify({ v:1, ts:BASE,     runId:'test-run', event:'session_start', task:'t', autoMode:false, baseCommit:'abc', harnessVersion:'2.0.0' }) + '\n' +
  JSON.stringify({ v:1, ts:BASE+100, runId:'test-run', event:'session_end',   status:'completed', totalWallMs:100 }) + '\n';

let tmpDir: string;
let harnessDir: string;
let sessionsRoot: string;

beforeEach(() => {
  tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-cmd-test-'));
  harnessDir  = path.join(tmpDir, '.harness');
  sessionsRoot = path.join(tmpDir, 'sessions');
  fs.mkdirSync(harnessDir, { recursive: true });
});

afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function setupEventsFile(runId: string, content: string): void {
  const repoKey = computeRepoKey(harnessDir);
  const dir = path.join(sessionsRoot, repoKey, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), content);
}

describe('retroCommand', () => {
  it('exit 1 and stderr message when events.jsonl not found', async () => {
    const mockExit   = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(retroCommand('no-such-run', { root: tmpDir, sessionsRoot })).rejects.toThrow('exit:1');
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('[retro] events.jsonl not found'));

    mockExit.mockRestore();
    mockStderr.mockRestore();
  });

  it('writes retrospective.md to <harnessDir>/<runId>/ on success', async () => {
    setupEventsFile('test-run', MINIMAL_EVENTS);
    await retroCommand('test-run', { root: tmpDir, sessionsRoot });
    const outPath = path.join(harnessDir, 'test-run', 'retrospective.md');
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.readFileSync(outPath, 'utf-8').length).toBeGreaterThan(0);
  });

  it('--stdout prints markdown to stdout and does NOT write file', async () => {
    setupEventsFile('test-run', MINIMAL_EVENTS);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await retroCommand('test-run', { root: tmpDir, sessionsRoot, stdout: true });
    expect(stdoutSpy).toHaveBeenCalled();
    expect(fs.existsSync(path.join(harnessDir, 'test-run', 'retrospective.md'))).toBe(false);
    stdoutSpy.mockRestore();
  });

  it('exit 1 when events.jsonl exists but is empty', async () => {
    const repoKey = computeRepoKey(harnessDir);
    const dir = path.join(sessionsRoot, repoKey, 'empty-run');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '');

    const mockExit   = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(retroCommand('empty-run', { root: tmpDir, sessionsRoot })).rejects.toThrow('exit:1');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockStderr.mockRestore();
  });
});
