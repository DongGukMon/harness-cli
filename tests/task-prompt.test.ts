import { describe, it, expect } from 'vitest';
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  applyTaskPromptChunk,
  createInitialTaskPromptState,
  looksLikeImplicitMultilinePaste,
} from '../src/task-prompt.js';

describe('task-prompt', () => {
  describe('looksLikeImplicitMultilinePaste', () => {
    it('returns false for single-line typed input', () => {
      expect(looksLikeImplicitMultilinePaste('hello')).toBe(false);
      expect(looksLikeImplicitMultilinePaste('hello\r')).toBe(false);
    });

    it('returns true for a multiline pasted chunk without bracketed wrappers', () => {
      expect(looksLikeImplicitMultilinePaste('line 1\nline 2')).toBe(true);
      expect(looksLikeImplicitMultilinePaste('line 1\r\nline 2')).toBe(true);
      expect(looksLikeImplicitMultilinePaste('line 1\n\nline 3')).toBe(true);
    });
  });

  describe('applyTaskPromptChunk', () => {
    it('submits on Enter for normal typed input', () => {
      let state = createInitialTaskPromptState();
      state = applyTaskPromptChunk(state, 'abc').state;
      const step = applyTaskPromptChunk(state, '\r');

      expect(step.signal).toBe('submit');
      expect(step.state.buffer).toBe('abc');
    });

    it('captures an implicit multiline paste chunk without submitting', () => {
      const step = applyTaskPromptChunk(
        createInitialTaskPromptState(),
        'line 1\nline 2',
      );

      expect(step.signal).toBeUndefined();
      expect(step.state.buffer).toBe('line 1\nline 2');
    });

    it('captures explicit bracketed paste newlines and submits only on later Enter', () => {
      let state = createInitialTaskPromptState();
      let step = applyTaskPromptChunk(
        state,
        `${BRACKETED_PASTE_START}line 1\r\nline 2${BRACKETED_PASTE_END}`,
      );
      state = step.state;

      expect(step.signal).toBeUndefined();
      expect(state.buffer).toBe('line 1\nline 2');

      step = applyTaskPromptChunk(state, '\r');
      expect(step.signal).toBe('submit');
      expect(step.state.buffer).toBe('line 1\nline 2');
    });

    it('handles bracketed paste sequences split across multiple chunks', () => {
      let state = createInitialTaskPromptState();

      state = applyTaskPromptChunk(state, '\x1b[20').state;
      expect(state.pendingEscape).toBe('\x1b[20');

      state = applyTaskPromptChunk(state, '0~hello\nworld').state;
      expect(state.inPaste).toBe(true);
      expect(state.buffer).toBe('hello\nworld');

      const step = applyTaskPromptChunk(state, '\x1b[201~');
      expect(step.state.inPaste).toBe(false);
      expect(step.state.buffer).toBe('hello\nworld');
    });

    it('backspace removes the last buffered character', () => {
      let state = createInitialTaskPromptState();
      state = applyTaskPromptChunk(state, 'ab').state;

      const step = applyTaskPromptChunk(state, '\x7f');
      expect(step.state.buffer).toBe('a');
    });
  });
});
