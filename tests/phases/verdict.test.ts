import { describe, it, expect } from 'vitest';
import { extractCodexMetadata } from '../../src/phases/verdict.js';

describe('extractCodexMetadata', () => {
  it('parses tokens used and session id', () => {
    const stdout = `blah blah
tokens used
19,123
session id: abc-def-123
more blah`;
    const result = extractCodexMetadata(stdout);
    expect(result.tokensTotal).toBe(19123);
    expect(result.codexSessionId).toBe('abc-def-123');
  });

  it('handles tokens without commas', () => {
    const stdout = `tokens used\n45000`;
    expect(extractCodexMetadata(stdout).tokensTotal).toBe(45000);
  });

  it('returns empty object when both absent', () => {
    expect(extractCodexMetadata('no metadata here')).toEqual({});
  });

  it('case-insensitive session id match', () => {
    const stdout = `Session ID: 0123-4567-89ab`;
    expect(extractCodexMetadata(stdout).codexSessionId).toBe('0123-4567-89ab');
  });

  // Real Codex `exec` wiring: the metadata lines (`session id:`, `tokens used`) land
  // on STDERR while stdout carries only the model's final answer. These regressions
  // cover the case the runner actually encounters.
  it('parses metadata when it lives on stderr (matches real codex exec wiring)', () => {
    const stdout = 'REJECT\n';
    const stderr = [
      'OpenAI Codex v0.121.0 (research preview)',
      '--------',
      'session id: 019d9f82-8d29-78d2-a06c-1225569879fe',
      '--------',
      'user',
      'some prompt',
      '',
      'hook: Stop Completed',
      'tokens used',
      '18,443',
    ].join('\n');
    const result = extractCodexMetadata(stdout, stderr);
    expect(result.tokensTotal).toBe(18443);
    expect(result.codexSessionId).toBe('019d9f82-8d29-78d2-a06c-1225569879fe');
  });

  it('prefers stdout matches over stderr when both present', () => {
    // Belt-and-suspenders: if a future Codex release moves metadata to stdout, do not
    // silently drop the newer signal. Current regex matches the first occurrence; stdout
    // comes first in the combined string so it wins.
    const stdout = 'session id: aaaa-bbbb-cccc\ntokens used\n100';
    const stderr = 'session id: zzzz-yyyy-xxxx\ntokens used\n999';
    const result = extractCodexMetadata(stdout, stderr);
    expect(result.codexSessionId).toBe('aaaa-bbbb-cccc');
    expect(result.tokensTotal).toBe(100);
  });

  it('backwards-compatible: stderr argument is optional', () => {
    // Existing callers (and the original single-arg signature) must keep working.
    expect(extractCodexMetadata('session id: 1234-5678').codexSessionId).toBe('1234-5678');
  });
});
