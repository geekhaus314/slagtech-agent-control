import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.js';
import { collectFiles } from '../core/files.js';
import { analyzeProject } from '../core/analyze.js';
import { detectCommands } from '../core/verify.js';
import {
  buildDefaultFacts,
  inferFactsFromPrompt,
  loadFacts,
  factSummary,
  questionsFor,
  deliveryModeFromFacts,
} from '../core/facts.js';
import { writeJsonAtomic, TOOL_VERSION } from '../core/engine.js';
import { ALL_TOOL_IDS, installAdapters } from '../adapters/index.js';
import { colorEnabled, listFlag } from '../cli.js';
import { colorize } from '../report/text.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export async function runInit({ flags }) {
  const cwd = path.resolve(flags.cwd ? String(flags.cwd) : process.cwd());
  let loaded = await loadConfig(cwd);
  const root = loaded.source ? loaded.root : cwd;
  const c = colorize(colorEnabled(flags));
  const steps = [];
  const warnings = [];

  const collected = await collectFiles(root, loaded.config);
  const analysis = analyzeProject({ files: collected.files, packageJson: collected.packageJson, config: loaded.config });
  const detected = await detectCommands(root, loaded.config);
  const commandMap = Object.fromEntries(
    detected.commands
      .filter((entry) => entry.name !== 'install')
      .map((entry) => [entry.name, entry.command]),
  );

  const configPath = path.join(root, 'slag.config.json');
  const hasConfig = loaded.source && loaded.source.endsWith('slag.config.json');
  if (!hasConfig || flags.force) {
    await writeSchemas(root);
    const config = {
      $schema: './slag.schema.json',
      version: 1,
      strictness: flags.strict ? 'strict' : flags.relaxed ? 'relaxed' : 'standard',
      mode: 'auto',
      factsFile: 'slag.facts.json',
      framework: analysis.framework.frontend ?? 'auto',
      include: ['**/*'],
      ignore: [],
      commands: commandMap,
      capabilities: [],
      limits: {},
      verification: {
        timeoutMs: 600000,
        requireEvidence: true,
        requiredCommands: [],
        allowNoCommands: false,
      },
    };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    steps.push(`config: ${path.relative(root, configPath)}`);
    loaded = await loadConfig(root);
  } else {
    warnings.push(`Config already exists at ${path.relative(root, loaded.source)}; left unchanged (use --force to rewrite).`);
    await writeSchemas(root);
  }

  const factsAbs = path.join(root, loaded.config.factsFile ?? 'slag.facts.json');
  const existingFacts = await loadFacts(root, loaded.config);
  let facts = existingFacts.facts;
  let factsWritten = false;
  if (existingFacts.missing || flags.force) {
    const inferred = inferFactsFromPrompt(flags.prompt ? String(flags.prompt) : '');
    facts = existingFacts.missing ? inferred.facts : mergeFacts(existingFacts.facts, inferred.facts);
    const explicitMode = normalizeMode(flags.mode);
    if (explicitMode) {
      const modeFact = facts.find((fact) => fact.id === 'delivery.mode');
      modeFact.value = explicitMode;
      modeFact.status = 'confirmed';
      modeFact.source = '--mode flag';
    }
    await writeJsonAtomic(factsAbs, {
      $schema: './slag.facts.schema.json',
      version: 1,
      generatedAt: new Date().toISOString(),
      facts,
    });
    factsWritten = true;
    steps.push(`facts: ${path.relative(root, factsAbs)}${existingFacts.missing ? '' : ' (regenerated)'}`);
  } else {
    steps.push(`facts: ${path.relative(root, factsAbs)} (existing)`);
  }

  const tools = listFlag(flags.tools);
  const adapters = await installAdapters(root, tools.length ? tools : ALL_TOOL_IDS, {
    force: Boolean(flags.force),
    project: {
      commands: { verify: 'npx slag verify', gate: 'npx slag gate', ...commandMap },
      framework: analysis.framework,
    },
  });
  if (adapters.written.length) steps.push(`agent adapters: ${adapters.written.join(', ')}`);
  if (adapters.skipped.length) warnings.push(`Skipped existing adapter files without markers: ${adapters.skipped.join(', ')} (use --force to replace).`);
  warnings.push(...adapters.warnings);

  await ensureGitignore(root);
  steps.push('gitignore: .slag/');

  if (flags.ci !== false) {
    const workflow = await writeCi(root, collected.packageJson);
    steps.push(`ci: ${path.relative(root, workflow)}`);
  }
  if (flags.hooks !== false) {
    const slug = toolCommand(collected.packageJson);
    const hook = await writeHook(root, slug);
    steps.push(`hook: ${path.relative(root, hook)}`);
    if (flags.hooks === true) {
      try {
        execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' });
        steps.push('git: core.hooksPath = .githooks');
      } catch {
        warnings.push('Could not set git hooks path.');
      }
    }
  }

  await writeIntegrations(root);
  steps.push('mcp: .slag/mcp.json');

  const summary = factSummary(facts);
  const open = questionsFor(facts).filter((question) => question.required);
  const mode = deliveryModeFromFacts(facts, normalizeMode(flags.mode));

  process.stdout.write(`${c.bold('slag init')} ${c.dim(TOOL_VERSION)}\n`);
  for (const step of steps) process.stdout.write(`  ${c.green('+')} ${step}\n`);
  for (const warning of warnings) process.stdout.write(`  ${c.yellow('!')} ${warning}\n`);
  process.stdout.write('\n');
  process.stdout.write(`Delivery mode: ${mode ? c.bold(mode) : c.yellow('unconfirmed')} · Facts: ${summary.requiredConfirmed}/${summary.requiredTotal} required confirmed\n`);

  if (open.length > 0) {
    process.stdout.write(`\n${c.yellow(c.bold('Before writing code, ask the user:'))}\n`);
    open.forEach((question, index) => {
      process.stdout.write(`  ${index + 1}. ${c.bold(question.id)} — ${question.question}\n`);
    });
  }
  process.stdout.write(`\nNext:\n  npx slag brief\n  npx slag audit\n  npx slag verify\n  npx slag gate\n`);
  return 0;
}

async function writeSchemas(root) {
  for (const name of ['schema.json', 'facts.schema.json']) {
    try {
      const source = path.join(PACKAGE_ROOT, name);
      const target = path.join(root, name === 'schema.json' ? 'slag.schema.json' : 'slag.facts.schema.json');
      const content = await fs.readFile(source, 'utf8');
      await fs.writeFile(target, content, 'utf8');
    } catch {
      // Schemas are editor convenience only.
    }
  }
}

async function ensureGitignore(root) {
  const abs = path.join(root, '.gitignore');
  let content = '';
  try {
    content = await fs.readFile(abs, 'utf8');
  } catch {
    content = '';
  }
  if (/^\.slag\/$/m.test(content)) return;
  const separator = content && !content.endsWith('\n') ? '\n' : '';
  await fs.writeFile(abs, `${content}${separator}\n# slag verification evidence\n.slag/\n`, 'utf8');
}

async function writeCi(root, packageJson) {
  const command = toolCommand(packageJson);
  const abs = path.join(root, '.github', 'workflows', 'slag.yml');
  const lock = await firstExisting(root, ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'package-lock.json']);
  const manager = lock === 'pnpm-lock.yaml' ? 'pnpm' : lock === 'yarn.lock' ? 'yarn' : lock === 'bun.lockb' || lock === 'bun.lock' ? 'bun' : 'npm';
  const installSteps = manager === 'npm'
    ? '      - run: npm ci || npm install'
    : manager === 'pnpm'
      ? '      - run: corepack enable\n      - run: pnpm install --frozen-lockfile || pnpm install'
      : manager === 'yarn'
        ? '      - run: corepack enable\n      - run: yarn install --immutable || yarn install'
        : '      - run: bun install';
  const content = `name: slag

on:
  push:
  pull_request:

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: corepack enable
${installSteps}
      - run: ${command} verify
      - run: ${command} gate
`;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return abs;
}

async function writeHook(root, command) {
  const abs = path.join(root, '.githooks', 'pre-commit');
  const content = `#!/bin/sh
# Installed by slag. Runs the anti-slop audit before committing.
${command} audit --quiet
`;
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  await fs.chmod(abs, 0o755);
  return abs;
}

async function writeIntegrations(root) {
  const snippets = {
    note: 'Run `slag mcp` over stdio. Add the snippet for your agent, then restart it.',
    opencode: {
      mcp: {
        slag: { type: 'local', command: ['npx', '-y', 'slagtech-agent-control', 'mcp'], enabled: true },
      },
    },
    claude: {
      mcpServers: {
        slag: { command: 'npx', args: ['-y', 'slagtech-agent-control', 'mcp'] },
      },
    },
    cursor: {
      mcpServers: {
        slag: { command: 'npx', args: ['-y', 'slagtech-agent-control', 'mcp'] },
      },
    },
  };
  await writeJsonAtomic(path.join(root, '.slag', 'mcp.json'), snippets);
}

function toolCommand(packageJson) {
  if (packageJson?.name === 'slagtech-agent-control') return 'node bin/slag.js';
  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  if (deps['slagtech-agent-control']) return 'npx slag';
  return 'npx --yes slagtech-agent-control@latest';
}

function normalizeMode(value) {
  if (!value || value === true) return null;
  const mode = String(value).toLowerCase();
  if (['production', 'prod'].includes(mode)) return 'production';
  if (['prototype', 'mockup', 'demo'].includes(mode)) return 'prototype';
  return null;
}

function mergeFacts(existing, incoming) {
  const byId = new Map(existing.map((fact) => [fact.id, fact]));
  for (const fact of incoming) {
    const current = byId.get(fact.id);
    if (current && current.status === 'confirmed') continue;
    byId.set(fact.id, fact);
  }
  for (const fact of buildDefaultFacts()) {
    if (!byId.has(fact.id)) byId.set(fact.id, fact);
  }
  return [...byId.values()];
}

async function firstExisting(root, names) {
  for (const name of names) {
    try {
      await fs.access(path.join(root, name));
      return name;
    } catch {
      // keep looking
    }
  }
  return null;
}
