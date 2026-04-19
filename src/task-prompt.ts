import { renderWelcome } from './ui.js';

export type PromptResult =
  | { kind: 'task'; value: string }
  | { kind: 'empty' }
  | { kind: 'eof' }
  | { kind: 'interrupt' };

export interface TaskPromptState {
  buffer: string;
  inPaste: boolean;
  pendingEscape: string;
}

export interface TaskPromptStep {
  state: TaskPromptState;
  signal?: 'submit' | 'eof' | 'interrupt';
}

const BRACKETED_PASTE_ENABLE = '\x1b[?2004h';
const BRACKETED_PASTE_DISABLE = '\x1b[?2004l';
export const BRACKETED_PASTE_START = '\x1b[200~';
export const BRACKETED_PASTE_END = '\x1b[201~';

const KNOWN_BRACKETED_SEQUENCES = [BRACKETED_PASTE_START, BRACKETED_PASTE_END] as const;

export function createInitialTaskPromptState(): TaskPromptState {
  return {
    buffer: '',
    inPaste: false,
    pendingEscape: '',
  };
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function looksLikeImplicitMultilinePaste(rawChunk: string): boolean {
  if (rawChunk.includes(BRACKETED_PASTE_START) || rawChunk.includes(BRACKETED_PASTE_END)) {
    return false;
  }

  const chunk = normalizeNewlines(rawChunk);
  const firstNewline = chunk.indexOf('\n');
  if (firstNewline === -1) return false;

  const hasSecondNewline = chunk.indexOf('\n', firstNewline + 1) !== -1;
  const hasTextAfterFirstNewline = chunk
    .slice(firstNewline + 1)
    .replace(/\n/g, '')
    .length > 0;

  return hasSecondNewline || hasTextAfterFirstNewline;
}

export function applyTaskPromptChunk(
  prev: TaskPromptState,
  rawChunk: string,
): TaskPromptStep {
  if (!prev.inPaste && prev.pendingEscape === '' && looksLikeImplicitMultilinePaste(rawChunk)) {
    return {
      state: {
        ...prev,
        buffer: prev.buffer + normalizeNewlines(rawChunk),
      },
    };
  }

  let buffer = prev.buffer;
  let inPaste = prev.inPaste;
  let pendingEscape = '';

  const input = prev.pendingEscape + rawChunk;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const rest = input.slice(index);

    if (char === '\x1b') {
      if (KNOWN_BRACKETED_SEQUENCES.some((sequence) => sequence.startsWith(rest) && rest.length < sequence.length)) {
        pendingEscape = rest;
        break;
      }
      if (rest.startsWith(BRACKETED_PASTE_START)) {
        inPaste = true;
        index += BRACKETED_PASTE_START.length - 1;
        continue;
      }
      if (rest.startsWith(BRACKETED_PASTE_END)) {
        inPaste = false;
        index += BRACKETED_PASTE_END.length - 1;
        continue;
      }
      continue;
    }

    if (char === '\x03') {
      return {
        state: { buffer, inPaste, pendingEscape },
        signal: 'interrupt',
      };
    }

    if (char === '\x04') {
      return {
        state: { buffer, inPaste, pendingEscape },
        signal: 'eof',
      };
    }

    if (char === '\x7f' || char === '\b') {
      buffer = buffer.slice(0, -1);
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (inPaste) {
        buffer += '\n';
        if (char === '\r' && input[index + 1] === '\n') {
          index += 1;
        }
        continue;
      }
      return {
        state: { buffer, inPaste, pendingEscape },
        signal: 'submit',
      };
    }

    buffer += char;
  }

  return {
    state: { buffer, inPaste, pendingEscape },
  };
}

function formatPromptBufferForDisplay(buffer: string): string {
  if (buffer.length === 0) return '  > ';

  const lines = buffer.split('\n');
  if (lines.length === 1) {
    return `  > ${lines[0]}`;
  }
  return `  > ${lines[0]}\n    ${lines.slice(1).join('\n    ')}`;
}

function renderTaskPrompt(runId: string, buffer: string): void {
  renderWelcome(runId);
  process.stderr.write(formatPromptBufferForDisplay(buffer));
}

function canAppendIncrementally(
  prev: TaskPromptState,
  next: TaskPromptState,
  rawChunk: string,
): boolean {
  return prev.pendingEscape === ''
    && next.pendingEscape === ''
    && !prev.inPaste
    && !next.inPaste
    && !/[\x1b\r\n\x7f\b\x03\x04]/.test(rawChunk)
    && next.buffer === prev.buffer + rawChunk;
}

export function promptForTask(runId: string): Promise<PromptResult> {
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    return Promise.resolve({ kind: 'eof' });
  }

  return new Promise<PromptResult>((resolve) => {
    let state = createInitialTaskPromptState();
    let done = false;

    const cleanup = (): void => {
      if (done) return;
      done = true;
      process.stderr.write(BRACKETED_PASTE_DISABLE);
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };

    const finish = (result: PromptResult): void => {
      cleanup();
      resolve(result);
    };

    const onData = (buf: Buffer): void => {
      const prevState = state;
      const rawChunk = buf.toString('utf-8');
      const step = applyTaskPromptChunk(state, rawChunk);
      state = step.state;

      if (step.signal === 'interrupt') {
        finish({ kind: 'interrupt' });
        return;
      }

      if (step.signal === 'eof') {
        finish({ kind: 'eof' });
        return;
      }

      if (step.signal === 'submit') {
        const trimmed = state.buffer.trim();
        finish(trimmed ? { kind: 'task', value: trimmed } : { kind: 'empty' });
        return;
      }

      if (canAppendIncrementally(prevState, state, rawChunk)) {
        process.stderr.write(rawChunk);
      } else {
        renderTaskPrompt(runId, state.buffer);
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    process.stderr.write(BRACKETED_PASTE_ENABLE);
    renderTaskPrompt(runId, state.buffer);
  });
}
