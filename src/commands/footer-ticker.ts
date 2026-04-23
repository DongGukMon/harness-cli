import fs from 'fs';
import { aggregateFooter, readEventsJsonl, readStateSlice } from '../metrics/footer-aggregator.js';
import { clearFooterRow, formatFooter, writeFooterToPane } from '../ui.js';
import type { SessionLogger } from '../types.js';
import { mounted } from '../ink/render.js';
import { dispatchFooter } from '../ink/store.js';

export interface FooterTickerOptions {
  logger: SessionLogger;
  stateJsonPath: string;
  intervalMs: number;
}

export interface FooterTicker {
  stop(): void;
  forceTick(): void;
}

const INERT_TICKER: FooterTicker = {
  stop(): void {},
  forceTick(): void {},
};

export function startFooterTicker(opts: FooterTickerOptions): FooterTicker {
  const eventsPath = opts.logger.getEventsPath();
  if (eventsPath === null) {
    return INERT_TICKER;
  }

  let stopped = false;

  const onTick = (): void => {
    try {
      if (!fs.existsSync(eventsPath)) {
        return;
      }

      const events = readEventsJsonl(eventsPath);
      const stateSlice = readStateSlice(opts.stateJsonPath);
      if (stateSlice === null) {
        return;
      }

      const summary = aggregateFooter(events, stateSlice, Date.now());
      if (summary === null) {
        return;
      }

      if (mounted) {
        dispatchFooter(summary);
        return;
      }

      const columns = process.stderr.columns;
      const rows = process.stderr.rows;
      if (
        process.stderr.isTTY !== true ||
        typeof columns !== 'number' ||
        columns <= 0 ||
        typeof rows !== 'number' ||
        rows <= 0
      ) {
        return;
      }

      writeFooterToPane(formatFooter(summary, columns), rows, columns);
    } catch {
      return;
    }
  };

  const onProcessExit = (): void => {
    if (stopped) {
      return;
    }

    clearInterval(timerId);

    const rows = process.stderr.rows;
    if (process.stderr.isTTY === true && typeof rows === 'number' && rows > 0) {
      clearFooterRow(rows);
    }

    process.removeListener('exit', onProcessExit);
    stopped = true;
  };

  const timerId = setInterval(onTick, opts.intervalMs);
  process.on('exit', onProcessExit);

  return {
    stop(): void {
      if (stopped) {
        return;
      }

      clearInterval(timerId);

      const rows = process.stderr.rows;
      if (process.stderr.isTTY === true && typeof rows === 'number' && rows > 0) {
        clearFooterRow(rows);
      }

      process.removeListener('exit', onProcessExit);
      stopped = true;
    },
    forceTick(): void {
      onTick();
    },
  };
}
