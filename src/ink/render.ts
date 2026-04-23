import React from 'react';
import { render } from 'ink';
import type { HarnessState, SessionLogger, RenderCallsite } from '../types.js';
import { dispatch } from './store.js';
import { App } from './App.js';

export let mounted = false;

let inkInstance: { unmount(): void } | null = null;

function cleanup(): void {
  if (inkInstance !== null) {
    try { inkInstance.unmount(); } catch { /* best-effort */ }
    inkInstance = null;
  }
  mounted = false;
}

/** Call before InputManager.stop() — preserves shutdown order: Ink unmount → InputManager.stop() → exit */
export function unmountInk(): void {
  cleanup();
}

export function renderInkControlPanel(
  state: HarnessState,
  logger?: SessionLogger,
  callsite?: RenderCallsite,
): void {
  // Always emit telemetry regardless of TTY
  if (logger !== undefined && callsite !== undefined) {
    const phaseStatus = state.phases[String(state.currentPhase)] ?? 'pending';
    logger.logEvent({ event: 'ui_render', phase: state.currentPhase, phaseStatus, callsite });
  }

  // Non-TTY fallback: plain stderr status line, no Ink mount
  if (process.stdin.isTTY !== true) {
    const status = state.phases[String(state.currentPhase)] ?? 'pending';
    process.stderr.write(`[harness] phase=${state.currentPhase} status=${status}\n`);
    return;
  }

  // Update store (triggers React re-render if already mounted)
  dispatch({ state, callsite });

  if (!mounted) {
    process.stdout.write('\x1b[2J\x1b[H');
    inkInstance = render(React.createElement(App), {
      stdin: process.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    mounted = true;
    process.once('exit', cleanup);
  }
}
