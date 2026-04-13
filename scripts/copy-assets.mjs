#!/usr/bin/env node
/**
 * Copy non-TS assets (prompt templates, etc.) from src/ to dist/src/
 * after tsc runs. tsc does not handle non-.ts files.
 */
import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const assets = [
  { from: 'src/context/prompts', to: 'dist/src/context/prompts' },
];

for (const asset of assets) {
  const src = join(root, asset.from);
  const dst = join(root, asset.to);
  if (!existsSync(src)) {
    console.warn(`[copy-assets] skip: ${asset.from} does not exist`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[copy-assets] copied ${asset.from} -> ${asset.to}`);
}
