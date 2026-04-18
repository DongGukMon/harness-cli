#!/usr/bin/env node
/**
 * Copy non-TS assets (prompt templates, etc.) from src/ to dist/src/
 * after tsc runs. tsc does not handle non-.ts files.
 */
import { cpSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const assets = [
  { from: 'src/context/prompts',   to: 'dist/src/context/prompts',   recursive: true },
  { from: 'src/context/skills',    to: 'dist/src/context/skills',    recursive: true },
  { from: 'src/context/playbooks', to: 'dist/src/context/playbooks', recursive: true },
  { from: 'scripts/harness-verify.sh', to: 'dist/scripts/harness-verify.sh', recursive: false, executable: true },
];

for (const asset of assets) {
  const src = join(root, asset.from);
  const dst = join(root, asset.to);
  if (!existsSync(src)) {
    console.warn(`[copy-assets] skip: ${asset.from} does not exist`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: asset.recursive });
  if (asset.executable) {
    chmodSync(dst, 0o755);
  }
  console.log(`[copy-assets] copied ${asset.from} -> ${asset.to}`);
}
