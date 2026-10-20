import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './files.js';

export const STRICTNESS_PRESETS = {
  relaxed: {
    label: 'relaxed',
    description: 'Prototype mode. Structural problems warn, security problems still fail.',
  },
  standard: {
    label: 'standard',
    description: 'Default. Fake functionality, placeholders and dead controls fail the gate.',
  },
  strict: {
    label: 'strict',
    description: 'Production mode. Quality, accessibility, tests and evidence are enforced.',
  },
};

export const CONFIG_FILENAMES = ['slag.config.json', 'slag.config.jsonc', '.slagrc.json', '.slagrc.jsonc'];

export const DEFAULT_IGNORE = [
  'node_modules/**',
  '.git/**',
  '.slag/**',
  '.next/**',
  '.nuxt/**',
  '.svelte-kit/**',
  '.astro/**',
  '.turbo/**',
  '.vercel/**',
  '.output/**',
  '.netlify/**',
  '.cache/**',
  'dist/**',
  'build/**',
  'out/**',
  'coverage/**',
  'vendor/**',
  'target/**',
  '.venv/**',
  'venv/**',
  '__pycache__/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/*.generated.*',
  '**/generated/**',
  '**/__generated__/**',
  '**/*.d.ts',
];

export function defaultConfig() {
  return {
    version: 1,
    strictness: 'standard',
    mode: 'auto',
    framework: 'auto',
    factsFile: 'slag.facts.json',
    include: ['**/*'],
    ignore: [...DEFAULT_IGNORE],
    commands: {},
    capabilities: [],
    rules: {},
    limits: {
      maxFileBytes: 1_500_000,
      maxFiles: 20_000,
      maxTodo: 8,
      maxAnyPerFile: 12,
      maxFileLines: 700,
      maxConsoleLogs: 10,
    },
    verification: {
      timeoutMs: 600_000,
      requireEvidence: true,
      requiredCommands: [],
      allowNoCommands: false,
    },
  };
}

export async function findRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  const gitRoot = await findGitRoot(current);
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      try {
        await fs.access(path.join(current, name));
        return current;
      } catch {
        // keep looking
      }
    }
    if (gitRoot && current === gitRoot) return gitRoot;
    const parent = path.dirname(current);
    if (parent === current) return gitRoot ?? path.resolve(startDir);
    current = parent;
  }
}

async function findGitRoot(startDir) {
  let current = startDir;
  while (true) {
    try {
      await fs.access(path.join(current, '.git'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export async function loadConfig(startDir = process.cwd(), overrides = {}) {
  const root = await findRoot(startDir);
  const warnings = [];
  let source = null;
  let userConfig = {};

  for (const name of CONFIG_FILENAMES) {
    const abs = path.join(root, name);
    try {
      const raw = await fs.readFile(abs, 'utf8');
      if (name.endsWith('.jsonc')) {
        userConfig = JSON.parse(stripJsonComments(raw));
      } else {
        userConfig = JSON.parse(raw);
      }
      source = abs;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`Could not read ${abs}: ${error.message}`);
      }
    }
  }

  if (!source) {
    const pkg = await readJson(path.join(root, 'package.json'));
    if (pkg && pkg.slag && typeof pkg.slag === 'object') {
      userConfig = pkg.slag;
      source = 'package.json#slag';
    }
  }

  const config = normalizeConfig(mergeConfig(defaultConfig(), userConfig), warnings);
  if (overrides.strictness) config.strictness = overrides.strictness;
  if (overrides.commands) config.commands = { ...config.commands, ...overrides.commands };
  if (!STRICTNESS_PRESETS[config.strictness]) {
    warnings.push(`Unknown strictness "${config.strictness}", using "standard".`);
    config.strictness = 'standard';
  }
  return { root, config, warnings, source };
}

export function mergeConfig(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = mergeConfig(base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? base[key] : {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function normalizeConfig(config, warnings = []) {
  const ignore = new Set([...DEFAULT_IGNORE, ...(Array.isArray(config.ignore) ? config.ignore : [])]);
  config.ignore = [...ignore];
  if (!Array.isArray(config.include) || config.include.length === 0) config.include = ['**/*'];
  if (!Array.isArray(config.capabilities)) {
    warnings.push('capabilities must be an array; ignoring.');
    config.capabilities = [];
  }
  config.capabilities = config.capabilities.filter((capability) => {
    if (!capability || typeof capability !== 'object' || !capability.id) {
      warnings.push('A capability is missing an id; ignoring.');
      return false;
    }
    if (!Array.isArray(capability.evidence)) capability.evidence = [];
    capability.required = capability.required !== false;
    return true;
  });
  if (!config.limits || typeof config.limits !== 'object') config.limits = defaultConfig().limits;
  if (!config.verification || typeof config.verification !== 'object') config.verification = defaultConfig().verification;
  if (!config.rules || typeof config.rules !== 'object') config.rules = {};
  return config;
}

export function stripJsonComments(input) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 1;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

export function severityFor(rule, config, deliveryMode = null) {
  const override = config.rules?.[rule.id];
  if (override === false || override === 'off') return 'off';
  const allowed = ['info', 'warn', 'error'];
  if (typeof override === 'string' && override !== 'off' && !allowed.includes(override)) {
    return adjustForMode(rule, rule.severity[config.strictness] ?? rule.severity.standard, deliveryMode);
  }
  if (override === true) {
    return adjustForMode(rule, rule.severity[config.strictness] ?? rule.severity.standard, deliveryMode);
  }
  if (typeof override === 'string') return override;
  return adjustForMode(rule, rule.severity[config.strictness] ?? rule.severity.standard, deliveryMode);
}

function adjustForMode(rule, severity, deliveryMode) {
  if (!deliveryMode) return severity;
  if (deliveryMode === 'production') {
    if (severity === 'warn' && ['demo-content', 'completeness', 'verification'].includes(rule.impact)) {
      return 'error';
    }
    return severity;
  }
  if (deliveryMode === 'prototype') {
    if (severity === 'error' && rule.impact === 'demo-content') return 'warn';
    if (severity === 'error' && rule.category === 'stubs') return 'warn';
    if (severity === 'error' && rule.category === 'process') return 'warn';
    return severity;
  }
  return severity;
}
