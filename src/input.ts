type InputState = 'idle' | 'configuring' | 'prompt-single' | 'prompt-line';

export class InputManager {
  private state: InputState = 'idle';
  private isPreLoop: boolean = true;
  private handler: ((key: string) => void) | null = null;
  private onDataBound: ((buf: Buffer) => void) | null = null;
  private started = false;

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
      this.handler = (key: string) => {
        const lower = key.toLowerCase();
        if (validKeys.has(lower)) {
          this.handler = null;
          this.state = this.isPreLoop ? 'configuring' : 'idle';
          resolve(lower.toUpperCase());
        }
      };
    });
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

    // Idle/configuring without active prompt
    if (this.state === 'idle' || this.state === 'configuring') return;

    // Forward to active handler
    this.handler?.(str);
  }
}
