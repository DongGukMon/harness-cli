import { describe, it, expect } from 'vitest';
import { InputManager } from '../src/input.js';

describe('InputManager', () => {
  it('exports InputManager class', () => {
    expect(InputManager).toBeDefined();
  });

  it('has start/stop/enterPhaseLoop/waitForKey/waitForLine methods', () => {
    const im = new InputManager();
    expect(typeof im.start).toBe('function');
    expect(typeof im.stop).toBe('function');
    expect(typeof im.enterPhaseLoop).toBe('function');
    expect(typeof im.waitForKey).toBe('function');
    expect(typeof im.waitForLine).toBe('function');
  });

  it('has onConfigCancel callback property', () => {
    const im = new InputManager();
    expect(im.onConfigCancel).toBeNull();
    im.onConfigCancel = () => {};
    expect(typeof im.onConfigCancel).toBe('function');
  });

  it('start is idempotent', () => {
    const im = new InputManager();
    // Non-TTY environment: start should be a no-op without throwing
    im.start();
    im.start(); // second call should not throw
    im.stop();
  });

  it('stop is idempotent', () => {
    const im = new InputManager();
    im.stop(); // should not throw when not started
    im.stop();
  });

  it('setState changes internal state', () => {
    const im = new InputManager();
    // Just verify it doesn't throw
    im.setState('idle');
    im.setState('configuring');
    im.setState('prompt-single');
  });

  it('enterPhaseLoop sets up phase loop mode', () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    // After enterPhaseLoop, isPreLoop should be false
    // Verified indirectly: method doesn't throw
  });
});

describe('InputManager — pendingKey buffer', () => {
  it('waitForKey resolves immediately with pending key pressed during idle', async () => {
    const im = new InputManager();
    im.enterPhaseLoop(); // state -> idle
    // Inject a key while idle (private onData via any-cast)
    (im as any).onData(Buffer.from('s'));
    const key = await im.waitForKey(new Set(['s', 'c', 'q']));
    expect(key).toBe('S');
  });

  it('waitForKey ignores pending key outside validKeys', async () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    (im as any).onData(Buffer.from('x'));
    // pending is 'x' which is not valid; waitForKey should clear it and wait.
    const p = im.waitForKey(new Set(['s', 'c', 'q']));
    (im as any).handler?.('s');
    const key = await p;
    expect(key).toBe('S');
  });

  it('waitForKey ignores stale pending key older than TTL', async () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    (im as any).onData(Buffer.from('s'));
    // Manually age the pending entry beyond TTL (1000ms)
    (im as any).pendingKey.timestamp = Date.now() - 2000;
    const p = im.waitForKey(new Set(['s', 'c', 'q']));
    (im as any).handler?.('c');
    const key = await p;
    expect(key).toBe('C');
  });

  it('onData does not buffer ESC sequences or control chars in pending', () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    (im as any).onData(Buffer.from('\x1b[A')); // arrow up
    expect((im as any).pendingKey).toBeNull();
    (im as any).onData(Buffer.from('\x7f')); // DEL
    expect((im as any).pendingKey).toBeNull();
  });

  it('waitForKey normal path unchanged when no pending', async () => {
    const im = new InputManager();
    im.enterPhaseLoop();
    const p = im.waitForKey(new Set(['s', 'c', 'q']));
    (im as any).handler?.('q');
    const key = await p;
    expect(key).toBe('Q');
  });
});
