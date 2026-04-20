#!/usr/bin/env node
import { Command } from 'commander';
import { startCommand } from '../src/commands/start.js';
import { resumeCommand } from '../src/commands/resume.js';
import { statusCommand } from '../src/commands/status.js';
import { listCommand } from '../src/commands/list.js';
import { skipCommand } from '../src/commands/skip.js';
import { jumpCommand } from '../src/commands/jump.js';
import { innerCommand } from '../src/commands/inner.js';
import { installSkillsCommand } from '../src/commands/install-skills.js';
import { uninstallSkillsCommand } from '../src/commands/uninstall-skills.js';
import { cleanupCommand } from '../src/commands/cleanup.js';
import { HARNESS_VERSION } from '../src/version.js';

const program = new Command();

program
  .name('phase-harness')
  .description('AI agent harness orchestrator')
  .version(HARNESS_VERSION)
  .option('--root <dir>', 'explicit .harness/ parent directory');

program
  .command('start [task]')
  .description('start a new harness session')
  .option('--require-clean', 'block if working tree has any uncommitted changes')
  .option('--auto', 'autonomous mode (no user escalations)')
  .option('--enable-logging', 'enable session logging to ~/.harness/sessions')
  .option('--light', 'use the 4-phase light flow (P1 → P5 → P6 → P7)')
  .option('--codex-no-isolate', 'bypass CODEX_HOME isolation for codex subprocesses (not recommended)')
  .action(async (task: string | undefined, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean; light?: boolean; codexNoIsolate?: boolean }) => {
    const globalOpts = program.opts();
    await startCommand(task, { ...opts, root: globalOpts.root });
  });

program
  .command('run [task]')
  .description('alias for start')
  .option('--require-clean', 'block if working tree has any uncommitted changes')
  .option('--auto', 'autonomous mode (no user escalations)')
  .option('--enable-logging', 'enable session logging to ~/.harness/sessions')
  .option('--light', 'use the 4-phase light flow (P1 → P5 → P6 → P7)')
  .option('--codex-no-isolate', 'bypass CODEX_HOME isolation for codex subprocesses (not recommended)')
  .action(async (task: string | undefined, opts: { requireClean?: boolean; auto?: boolean; enableLogging?: boolean; light?: boolean; codexNoIsolate?: boolean }) => {
    const globalOpts = program.opts();
    await startCommand(task, { ...opts, root: globalOpts.root });
  });

program
  .command('resume [runId]')
  .description('resume an existing run')
  .option('--light', '(rejected — flow is frozen at run creation)')
  .action(async (runId: string | undefined, opts: { light?: boolean }) => {
    const globalOpts = program.opts();
    await resumeCommand(runId, { ...opts, root: globalOpts.root });
  });

program
  .command('status')
  .description('show current run status')
  .action(async () => {
    const globalOpts = program.opts();
    await statusCommand({ root: globalOpts.root });
  });

program
  .command('list')
  .description('list all runs')
  .action(async () => {
    const globalOpts = program.opts();
    await listCommand({ root: globalOpts.root });
  });

program
  .command('skip')
  .description('skip the current phase')
  .action(async () => {
    const globalOpts = program.opts();
    await skipCommand({ root: globalOpts.root });
  });

program
  .command('jump <phase>')
  .description('jump backward to a previous phase (1-7)')
  .action(async (phase: string) => {
    const globalOpts = program.opts();
    await jumpCommand(phase, { root: globalOpts.root });
  });

program
  .command('__inner <runId>', { hidden: true })
  .description('(internal) run phase loop inside tmux session')
  .option('--root <dir>', 'explicit .harness/ parent directory')
  .option('--control-pane <paneId>', 'tmux pane ID for control panel')
  .option('--resume', 'resume mode (invoked from harness resume)')
  .action(async (runId: string, opts: { root?: string; controlPane?: string; resume?: boolean }) => {
    const globalOpts = program.opts();
    await innerCommand(runId, { root: opts.root ?? globalOpts.root, controlPane: opts.controlPane, resume: opts.resume });
  });

program
  .command('install-skills')
  .description('install standalone skills to user or project Claude Code scope')
  .option('--user', 'install to user scope (~/.claude/skills/) [default]')
  .option('--project', 'install to project scope (./.claude/skills/)')
  .option('--project-dir <path>', 'install to <path>/.claude/skills/ (implies --project)')
  .action(async (opts: { user?: boolean; project?: boolean; projectDir?: string }) => {
    await installSkillsCommand(opts);
  });

program
  .command('uninstall-skills')
  .description('uninstall phase-harness skills from user or project Claude Code scope')
  .option('--user', 'uninstall from user scope (~/.claude/skills/) [default]')
  .option('--project', 'uninstall from project scope (./.claude/skills/)')
  .option('--project-dir <path>', 'uninstall from <path>/.claude/skills/ (implies --project)')
  .action(async (opts: { user?: boolean; project?: boolean; projectDir?: string }) => {
    await uninstallSkillsCommand(opts);
  });

program
  .command('cleanup')
  .description('list and kill orphaned harness tmux sessions in the current repo')
  .option('--dry-run', 'classify and print sessions without killing any')
  .option('--yes', 'skip confirmation prompt and kill orphans automatically')
  .action(async (opts: { dryRun?: boolean; yes?: boolean }) => {
    const globalOpts = program.opts();
    await cleanupCommand({ ...opts, root: globalOpts.root });
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
