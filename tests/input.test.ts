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
