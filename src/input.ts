type InputState = 'idle' | 'configuring' | 'prompt-single' | 'prompt-line';

interface PendingKey {
  key: string;
  timestamp: number;
}

export class InputManager {
  private state: InputState = 'idle';
  private isPreLoop: boolean = true;
  private handler: ((key: string) => void) | null = null;
  private onDataBound: ((buf: Buffer) => void) | null = null;
  private started = false;
  private pendingKey: PendingKey | null = null;
  private static readonly PENDING_KEY_TTL_MS = 1000;

  /**
   * #117 Bug A: cancellation sentinel emitted by `cancelWaitForKey()` so a
   * concurrent file-channel poll can short-circuit the in-flight `waitForKey()`.
   * Picked because `\x00` is not a valid keystroke through the raw-mode pipe
   * (printable-ASCII gate in `onData` filters everything below 0x20).
   */
  public static readonly CANCEL_SENTINEL = '\x00';

  public onConfigCancel: (() => void) | null = null;

  start(initialState: InputState = 'configuring'): void {
    if (this.started) return;
    if (!process.stdin.isTTY) return;
    this.state = initialState;
    this.isPreLoop = true;
    this.started = true;

    this.onDataBound = (buf: Buffer) => this.onData(buf);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', this.onDataBound);
  }

  stop(): void {
    if (!this.started) return;
    if (this.onDataBound) {
      process.stdin.removeListener('data', this.onDataBound);
      this.onDataBound = null;
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    this.pendingKey = null;
    this.started = false;
  }

  enterPhaseLoop(): void {
    this.isPreLoop = false;
    this.state = 'idle';
  }

  setState(state: InputState): void {
    this.state = state;
  }

  waitForKey(validKeys: Set<string>): Promise<string> {
    return new Promise((resolve) => {
      this.state = 'prompt-single';

      // Consume pending key from idle-state buffer if still fresh and valid.
      if (this.pendingKey !== null) {
        const { key, timestamp } = this.pendingKey;
        this.pendingKey = null;
        if (
          Date.now() - timestamp <= InputManager.PENDING_KEY_TTL_MS &&
          validKeys.has(key.toLowerCase())
        ) {
          this.state = this.isPreLoop ? 'configuring' : 'idle';
          resolve(key.toLowerCase().toUpperCase());
          return;
        }
      }

      this.handler = (key: string) => {
        // #117 Bug A: `cancelWaitForKey()` calls the handler with the cancellation
        // sentinel to short-circuit a pending wait when an out-of-band action
        // arrives (e.g. file-channel signal). The wait resolves with the sentinel;
        // the caller is expected to discard it.
        if (key === InputManager.CANCEL_SENTINEL) {
          this.handler = null;
          this.state = this.isPreLoop ? 'configuring' : 'idle';
          resolve(InputManager.CANCEL_SENTINEL);
          return;
        }
        const lower = key.toLowerCase();
        if (validKeys.has(lower)) {
          this.handler = null;
          this.state = this.isPreLoop ? 'configuring' : 'idle';
          resolve(lower.toUpperCase());
        }
      };
    });
  }

  /**
   * #117 Bug A: cancel an in-flight `waitForKey()` so a concurrent signal path
   * (file channel) can take over. Resolves the pending promise with
   * `CANCEL_SENTINEL`; if no wait is pending this is a no-op. Additive — does
   * not change the normal keystroke path (the sentinel is filtered out of the
   * `onData` printable-ASCII gate, so it can never be produced by a real keypress).
   */
  cancelWaitForKey(): void {
    if (this.handler !== null) {
      this.handler(InputManager.CANCEL_SENTINEL);
    }
  }

  waitForLine(): Promise<string> {
    return new Promise((resolve) => {
      this.state = 'prompt-line';
      let buffer = '';
      this.handler = (key: string) => {
        if (key === '\r' || key === '\n') {
          this.handler = null;
          this.state = this.isPreLoop ? 'configuring' : 'idle';
          resolve(buffer.trim());
        } else if (key === '\x7f') {
          buffer = buffer.slice(0, -1);
          process.stderr.write('\b \b');
        } else {
          buffer += key;
          process.stderr.write(key);
        }
      };
    });
  }

  private onData(buf: Buffer): void {
    const str = buf.toString();

    // Ctrl+C / Ctrl+D
    if (str === '\x03' || str === '\x04') {
      if (this.isPreLoop) {
        this.onConfigCancel?.();
      } else {
        process.kill(process.pid, 'SIGINT');
      }
      return;
    }

    // ESC sequences (arrow keys, F-keys, etc.)
    if (str.startsWith('\x1b')) return;

    // Idle/configuring without active prompt — buffer single printable ASCII
    // so a pre-emptive keystroke (typed while escalation prompt was printing)
    // is not lost on the next waitForKey.
    if (this.state === 'idle' || this.state === 'configuring') {
      if (str.length === 1 && str.charCodeAt(0) >= 0x20 && str.charCodeAt(0) < 0x7f) {
        this.pendingKey = { key: str, timestamp: Date.now() };
      }
      return;
    }

    // Forward to active handler
    this.handler?.(str);
  }
}
