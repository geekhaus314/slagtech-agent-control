import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { collectFiles } from './files.js';
import { writeJsonAtomic } from './engine.js';

const PLACEHOLDER_TEST = /no test specified|echo\s+["']?error: no test/i;
const COMMAND_ORDER = ['install', 'build', 'typecheck', 'lint', 'test', 'e2e'];
const DEFAULT_TAIL = 8000;

export async function readPackageJson(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function detectPackageManager(root) {
  for (const [file, manager] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ]) {
    try {
      await fs.access(path.join(root, file));
      return manager;
    } catch {
      // keep looking
    }
  }
  const pkg = await readPackageJson(root);
  return pkg?.packageManager?.split('@')[0] ?? 'npm';
}

export async function detectCommands(root, config = {}, { only = null } = {}) {
  const pkg = await readPackageJson(root);
  const scripts = pkg?.scripts ?? {};
  const manager = await detectPackageManager(root);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const hasTs = Boolean(deps.typescript) && await exists(path.join(root, 'tsconfig.json'));
  const hasTests = await anyFile(root, [
    '**/*.test.*', '**/*.spec.*', 'test/**', 'tests/**', '__tests__/**', 'e2e/**',
  ]);
  const configured = config.commands ?? {};
  const commands = new Map();

  {
    if (typeof configured.install === 'string') commands.set('install', commandEntry('install', configured.install, 'config'));
    if (typeof configured.build === 'string') {
      commands.set('build', commandEntry('build', configured.build, 'config'));
    } else if (typeof scripts.build === 'string') {
      commands.set('build', commandEntry('build', runScript(manager, 'build'), 'script'));
    }
    if (typeof configured.typecheck === 'string') {
      commands.set('typecheck', commandEntry('typecheck', configured.typecheck, 'config'));
    } else if (typeof scripts.typecheck === 'string') {
      commands.set('typecheck', commandEntry('typecheck', runScript(manager, 'typecheck'), 'script'));
    } else if (hasTs) {
      commands.set('typecheck', commandEntry('typecheck', execTool(manager, 'tsc', ['--noEmit']), 'auto'));
    }
    if (typeof configured.lint === 'string') {
      commands.set('lint', commandEntry('lint', configured.lint, 'config'));
    } else if (typeof scripts.lint === 'string') {
      commands.set('lint', commandEntry('lint', runScript(manager, 'lint'), 'script'));
    }
    if (typeof configured.test === 'string') {
      commands.set('test', commandEntry('test', configured.test, 'config'));
    } else if (typeof scripts.test === 'string' && !PLACEHOLDER_TEST.test(scripts.test)) {
      commands.set('test', commandEntry('test', runScript(manager, 'test'), 'script'));
    } else if (hasTests && deps.vitest) {
      commands.set('test', commandEntry('test', execTool(manager, 'vitest', ['run']), 'auto'));
    } else if (hasTests && deps.jest) {
      commands.set('test', commandEntry('test', execTool(manager, 'jest', ['--ci']), 'auto'));
    }
    if (typeof configured.e2e === 'string') {
      commands.set('e2e', commandEntry('e2e', configured.e2e, 'config'));
    } else if (typeof scripts.e2e === 'string') {
      commands.set('e2e', commandEntry('e2e', runScript(manager, 'e2e'), 'script'));
    } else if (deps['@playwright/test'] && (await exists(path.join(root, 'playwright.config.ts')) || await exists(path.join(root, 'playwright.config.js')))) {
      commands.set('e2e', commandEntry('e2e', execTool(manager, 'playwright', ['test']), 'auto'));
    }
  }

  for (const [name, value] of Object.entries(configured)) {
    if (value === false || value === null) commands.delete(name);
  }

  const required = new Set(config.verification?.requiredCommands ?? []);
  const list = [...commands.values()]
    .filter((entry) => !only?.length || only.includes(entry.name))
    .map((entry) => ({ ...entry, required: required.size ? required.has(entry.name) : entry.required }))
    .sort((a, b) => COMMAND_ORDER.indexOf(a.name) - COMMAND_ORDER.indexOf(b.name));
  return { commands: list, manager, packageJson: pkg };
}

export async function runVerify({ root, config, audit, install = false, only = null, timeoutMs = null, onStart, onOutput }) {
  const detected = await detectCommands(root, config, { only });
  const commands = detected.commands.filter((entry) => entry.name !== 'install' || install);
  const finalCommands = commands.length > 0 ? commands : (install ? detected.commands.filter((entry) => entry.name === 'install') : []);
  if (install && !finalCommands.some((entry) => entry.name === 'install')) {
    finalCommands.unshift({ name: 'install', command: installCommand(detected.manager), source: 'auto', required: false });
  }
  const timeout = timeoutMs ?? config.verification?.timeoutMs ?? 600_000;
  const results = [];
  const startedAt = new Date().toISOString();

  for (const entry of finalCommands) {
    onStart?.(entry);
    const result = await runCommand(entry, { cwd: root, timeoutMs: timeout, onOutput });
    results.push(result);
  }

  const fingerprint = await fingerprintFiles(root, config);
  const evidence = {
    version: 1,
    tool: 'slag',
    generatedAt: new Date().toISOString(),
    startedAt,
    root,
    gitHead: gitHead(root),
    strictness: config.strictness,
    mode: audit?.facts?.deliveryMode ?? null,
    factsHash: audit?.facts?.hash ?? null,
    fingerprint,
    audit: audit ? {
      passed: audit.passed,
      score: audit.score,
      grade: audit.grade,
      summary: audit.summary,
      facts: { hash: audit.facts?.hash, requiredUnconfirmed: audit.facts?.requiredUnconfirmed ?? [] },
    } : null,
    commands: results.map((result) => ({ ...result, required: entryRequired(finalCommands, result.name), source: finalCommands.find((entry) => entry.name === result.name)?.source })),
    ok: results.every((result) => result.exitCode === 0) && (audit?.passed ?? true),
  };
  const evidencePath = path.join(root, '.slag', 'evidence.json');
  await writeJsonAtomic(evidencePath, evidence);
  return { ...evidence, evidencePath, manager: detected.manager, detected: finalCommands };
}

function entryRequired(commands, name) {
  return commands.find((entry) => entry.name === name)?.required ?? false;
}

export async function runCommand(entry, { cwd, timeoutMs, onOutput }) {
  const started = Date.now();
  const stdout = [];
  const stderr = [];
  const result = { name: entry.name, command: entry.command, exitCode: null, ok: false, durationMs: 0, timedOut: false, stdoutTail: '', stderrTail: '' };
  try {
    const child = spawn(entry.command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: '1', SLAG: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      result.timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout.push(text);
      onOutput?.(text, 'stdout');
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      onOutput?.(text, 'stderr');
    });
    result.exitCode = await new Promise((resolve) => {
      child.on('error', (error) => {
        stderr.push(`${error.message}\n`);
        resolve(127);
      });
      child.on('close', (code) => resolve(code ?? 1));
    });
    clearTimeout(timer);
  } catch (error) {
    stderr.push(`${error.message}\n`);
    result.exitCode = 127;
  }
  result.durationMs = Date.now() - started;
  result.ok = result.exitCode === 0 && !result.timedOut;
  result.stdoutTail = tail(stdout.join(''));
  result.stderrTail = tail(stderr.join(''));
  if (result.timedOut) result.stderrTail = tail(`${result.stderrTail}\nCommand timed out after ${timeoutMs}ms.`);
  return result;
}

export async function loadEvidence(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, '.slag', 'evidence.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function fingerprintFiles(root, config) {
  const { files } = await collectFiles(root, config);
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    hash.update(file.rel);
    hash.update('\0');
    hash.update(file.text);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function evaluateGate({ audit, evidence, config, fingerprint }) {
  const checks = [];
  const add = (name, ok, message) => checks.push({ name, ok, message });
  add('audit', audit.passed, audit.passed ? 'Audit passed.' : `${audit.summary.error} audit error(s).`);
  for (const fact of audit.facts?.items ?? []) {
    if (fact.required && fact.status !== 'confirmed') {
      add('facts-confirmed', false, `Required fact "${fact.id}" is ${fact.status}. Ask the user and confirm it.`);
    }
  }
  if (!checks.some((check) => check.name === 'facts-confirmed')) add('facts-confirmed', true, 'Required facts are confirmed.');

  if (!config.verification?.requireEvidence) {
    add('evidence', true, 'Evidence requirement disabled.');
  } else if (!evidence) {
    add('evidence', false, 'No .slag/evidence.json. Run `slag verify` first.');
  } else {
    add('evidence', true, 'Evidence file found.');
    add('evidence-fresh', evidence.fingerprint === fingerprint, evidence.fingerprint === fingerprint
      ? 'Evidence matches the current working tree.'
      : 'Evidence is stale: files changed since `slag verify`. Re-run it.');
    add('evidence-passed', evidence.ok === true, evidence.ok === true ? 'All recorded commands passed.' : 'Recorded verification commands failed.');
    if (audit.facts?.hash && evidence.factsHash) {
      add('facts-stale', evidence.factsHash === audit.facts.hash, evidence.factsHash === audit.facts.hash
        ? 'Facts match the evidence.'
        : 'Facts changed since verification. Re-run `slag verify`.');
    }
    const required = config.verification?.requiredCommands ?? [];
    if (required.length > 0) {
      for (const name of required) {
        const found = evidence.commands?.find((command) => command.name === name);
        add(`command:${name}`, Boolean(found && found.ok), found?.ok ? `${name} passed.` : `${name} was not run successfully.`);
      }
    } else if (evidence.commands?.length === 0 && !config.verification?.allowNoCommands) {
      add('commands', false, 'No verification commands were run. Configure build/test scripts or set commands in slag.config.json.');
    }
    for (const entry of evidence.commands ?? []) {
      if (!entry.required) continue;
      add(`required-command:${entry.name}`, entry.ok, entry.ok ? `${entry.name} passed.` : `${entry.name} failed.`);
    }
    const failed = evidence.commands?.filter((entry) => !entry.ok) ?? [];
    add('all-commands', failed.length === 0, failed.length === 0 ? 'No failed commands recorded.' : `Failed: ${failed.map((entry) => entry.name).join(', ')}.`);
  }
  return {
    passed: checks.every((check) => check.ok),
    checks,
  };
}

function commandEntry(name, command, source) {
  return { name, command, source, required: true };
}

function installCommand(manager) {
  if (manager === 'pnpm') return 'pnpm install';
  if (manager === 'yarn') return 'yarn install';
  if (manager === 'bun') return 'bun install';
  return 'npm install';
}

function runScript(manager, name) {
  if (manager === 'yarn') return `yarn run ${name}`;
  if (manager === 'pnpm') return `pnpm run ${name}`;
  if (manager === 'bun') return `bun run ${name}`;
  return `npm run ${name}`;
}

function execTool(manager, tool, args) {
  const suffix = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ');
  if (manager === 'pnpm') return `pnpm exec ${tool} ${suffix}`.trim();
  if (manager === 'yarn') return `yarn ${tool} ${suffix}`.trim();
  if (manager === 'bun') return `bunx ${tool} ${suffix}`.trim();
  return `npx --no-install ${tool} ${suffix}`.trim();
}

function tail(value) {
  if (value.length <= DEFAULT_TAIL) return value;
  return `…\n${value.slice(-DEFAULT_TAIL)}`;
}

function gitHead(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function exists(abs) {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function anyFile(root, patterns) {
  const { files } = await collectFiles(root, { ignore: [] });
  return files.some((file) => patterns.some((pattern) => globLike(file.rel, pattern)));
}

function globLike(value, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`).test(value);
}
