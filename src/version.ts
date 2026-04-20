import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

function loadHarnessVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Resolve package.json from both layouts:
    //   dev/tsx   → src/version.ts        (../package.json)
    //   built     → dist/src/version.js   (../../package.json)
    // Published npm tarball mirrors the built layout.
    for (const rel of ['../package.json', '../../package.json']) {
      try {
        const raw = readFileSync(join(here, rel), 'utf-8');
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        if (parsed.name === 'phase-harness' && typeof parsed.version === 'string') {
          return parsed.version;
        }
      } catch {
        // probe next candidate
      }
    }
  } catch {
    // fall through to fallback
  }
  return '0.0.0';
}

export const HARNESS_VERSION = loadHarnessVersion();
