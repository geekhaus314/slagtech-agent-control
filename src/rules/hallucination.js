import { builtinModules } from 'node:module';
import path from 'node:path';
import { appFiles } from './helpers.js';
import { stripJsonComments } from '../core/config.js';

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]|(?:^|[^.\w])(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DOC_EXTENSIONS = new Set(['.md', '.mdx']);
const DOC_LINK = /(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
const RUN_SCRIPT = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z][\w:-]*)/g;
const ENV_REF = /\b(?:process\.env|import\.meta\.env|Bun\.env|Deno\.env\.get\s*\(\s*['"])([A-Z][A-Z0-9_]*)/g;
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const ENV_ALLOWED = new Set([
  'NODE_ENV', 'CI', 'TZ', 'DEBUG', 'PORT', 'NODE_OPTIONS', 'NEXT_RUNTIME', 'VERCEL', 'VERCEL_ENV',
  'VERCEL_URL', 'AWS_REGION', 'AWS_LAMBDA_FUNCTION_NAME', 'LAMBDA_TASK_ROOT', 'PWD', 'HOME',
]);
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.json', '.css', '.scss', '.sass', '.less', '.md', '.mdx'];
const VIRTUAL_PREFIXES = ['node:', 'bun:', 'virtual:', 'astro:', 'svelte:', 'vite:', 'webpack:', 'data:', 'http:', 'https:', 'cloudflare:', 'workerd:', '#'];

export const hallucinationRules = [
  {
    id: 'phantom-dependency',
    category: 'hallucination',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Code imports a package that is not declared in package.json.',
    hint: 'Install the package and add it to dependencies, or remove the import. Do not invent modules; verify the API exists before using it.',
    run(ctx) {
      if (!ctx.packageJson) return;
      const declared = new Set([
        ...Object.keys(ctx.packageJson.dependencies ?? {}),
        ...Object.keys(ctx.packageJson.devDependencies ?? {}),
        ...Object.keys(ctx.packageJson.peerDependencies ?? {}),
        ...Object.keys(ctx.packageJson.optionalDependencies ?? {}),
      ]);
      const workspaceNames = collectWorkspaceNames(ctx.files);
      const aliases = readAliasPatterns(ctx.files);
      const knownFiles = new Set(ctx.files.map((file) => file.rel));
      const knownDirs = collectDirs(knownFiles);

      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        for (const match of file.text.matchAll(IMPORT_RE)) {
          const specifier = match[1] ?? match[2];
          if (!specifier) continue;
          if (match.index > 0 && file.lines[lineIndex(file, match.index)]?.trim().startsWith('//')) continue;
          if (VIRTUAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))) continue;
          if (specifier.startsWith('.') || specifier.startsWith('/')) {
            if (!resolveLocal(specifier, file.rel, ctx.root, knownFiles, knownDirs)) {
              ctx.report({
                file,
                index: match.index,
                message: `Import "${specifier}" does not resolve to a file.`,
                data: { specifier },
              });
            }
            continue;
          }
          if (isAlias(specifier)) {
            if (!resolveAlias(specifier, ctx.root, knownFiles, knownDirs, aliases)) {
              ctx.report({
                file,
                index: match.index,
                message: `Aliased import "${specifier}" does not resolve to a file.`,
                data: { specifier },
              });
            }
            continue;
          }
          const packageName = packageNameOf(specifier);
          if (!packageName) continue;
          if (BUILTINS.has(packageName) || BUILTINS.has(specifier)) continue;
          if (declared.has(packageName) || workspaceNames.has(packageName)) continue;
          if (packageName.startsWith('@types/')) continue;
          ctx.report({
            file,
            index: match.index,
            message: `Import "${packageName}" is not declared in package.json.`,
            data: { package: packageName },
          });
        }
      }
    },
  },
  {
    id: 'phantom-doc-file',
    category: 'hallucination',
    impact: 'completeness',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Documentation links to a local file that does not exist.',
    hint: 'Create the file or fix the link. Broken doc links are often leftovers from an imagined implementation.',
    run(ctx) {
      const knownFiles = new Set(ctx.files.map((file) => file.rel));
      const docs = ctx.files.filter((file) =>
        DOC_EXTENSIONS.has(file.ext) &&
        !file.isGenerated &&
        (/(^|\/)(readme|agents|claude|gemini|conventions|contributing)\.mdx?$/i.test(file.rel) || /(^|\/)docs?\//.test(file.rel)),
      );
      for (const file of docs) {
        const text = stripFences(file.text);
        for (const match of text.matchAll(DOC_LINK)) {
          const raw = match[2];
          if (/^(https?:|mailto:|tel:|#)/i.test(raw) || raw.startsWith('/')) continue;
          const target = raw.split('#')[0].split('?')[0];
          if (!target) continue;
          if (target.includes('${') || target.includes('<')) continue;
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.rel), target)).replace(/^\.\//, '');
          const candidates = [resolved, `${resolved}.md`, `${resolved}.mdx`, `${resolved}/README.md`, `${resolved}/readme.md`];
          if (candidates.some((candidate) => knownFiles.has(candidate))) continue;
          ctx.report({
            file,
            index: match.index,
            message: `Documentation link points at missing file "${target}".`,
            data: { target },
          });
        }
      }
    },
  },
  {
    id: 'invented-script',
    category: 'hallucination',
    impact: 'completeness',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Docs reference a package script that does not exist.',
    hint: 'Add the script or correct the command. Setup instructions that fail are a broken handoff.',
    run(ctx) {
      if (!ctx.packageJson?.scripts) return;
      const scripts = new Set(Object.keys(ctx.packageJson.scripts));
      const docs = ctx.files.filter((file) =>
        (DOC_EXTENSIONS.has(file.ext) || file.rel.startsWith('.github/')) &&
        !file.isTest && !file.isGenerated,
      );
      const seen = new Set();
      for (const file of docs) {
        const text = stripFences(file.text);
        for (const match of text.matchAll(RUN_SCRIPT)) {
          const script = match[1];
          if (['install', 'ci', 'exec', 'dlx', 'create', 'add', 'remove', 'update', 'publish', 'link', 'init', 'audit'].includes(script)) continue;
          if (scripts.has(script)) continue;
          const key = `${file.rel}|${script}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ctx.report({
            file,
            index: match.index,
            message: `Documentation runs "${script}" but package.json has no such script.`,
            data: { script },
          });
        }
      }
    },
  },
  {
    id: 'phantom-env',
    category: 'hallucination',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Code references an environment variable missing from .env.example.',
    hint: 'Document the variable in .env.example. Undocumented env vars make setup and deployment fail in ways agents cannot see locally.',
    run(ctx) {
      const example = ctx.files.find((file) => /(^|\/)\.env\.(example|sample|template)$/.test(file.rel));
      if (!example) return;
      const documented = new Set();
      for (const line of example.lines) {
        const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
        if (match) documented.add(match[1]);
      }
      const seen = new Set();
      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        for (const match of file.text.matchAll(ENV_REF)) {
          const name = match[1];
          if (ENV_ALLOWED.has(name) || documented.has(name)) continue;
          const key = `${name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ctx.report({
            file,
            index: match.index,
            message: `Environment variable "${name}" is used but not documented in ${example.rel}.`,
            data: { name },
          });
        }
      }
    },
  },
  {
    id: 'missing-asset',
    category: 'hallucination',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Local image or media reference points at an asset that does not exist.',
    hint: 'Add the real asset or remove the reference. Imagined filenames render as broken images.',
    run(ctx) {
      const publicFiles = new Set(
        ctx.files
          .filter((file) => /^(public|static)\//.test(file.rel))
          .map((file) => `/${file.rel.split('/').slice(1).join('/')}`),
      );
      if (publicFiles.size === 0) return;
      const regex = /\b(?:src|poster|srcSet|href)\s*=\s*["'`](\/(?!\/)[^"'`?#]+)["'`]/g;
      const seen = new Set();
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup && !file.isStyle) continue;
        for (const match of file.text.matchAll(regex)) {
          const asset = match[1];
          if (asset.startsWith('/api/') || asset.startsWith('/_next/')) continue;
          if (/\.(html?|js|mjs|css|txt|xml|json|ico)$/i.test(asset)) continue;
          if (publicFiles.has(asset)) continue;
          const key = `${file.rel}|${asset}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ctx.report({
            file,
            index: match.index,
            message: `Local asset "${asset}" does not exist in public/.`,
            data: { asset },
          });
        }
      }
    },
  },
];

function packageNameOf(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return specifier.split('/')[0] || null;
}

function isAlias(specifier) {
  return specifier.startsWith('@/') || specifier.startsWith('~/') || specifier.startsWith('$lib') || specifier.startsWith('@app/') || specifier.startsWith('@/');
}

function readAliasPatterns(files) {
  const config = files.find((file) => /(^|\/)(tsconfig|jsconfig)\.json$/.test(file.rel));
  if (!config) return [];
  try {
    const parsed = JSON.parse(stripJsonComments(config.text));
    const paths = parsed.compilerOptions?.paths ?? {};
    return Object.entries(paths).map(([pattern, targets]) => ({ pattern, targets: Array.isArray(targets) ? targets : [] }));
  } catch {
    return [];
  }
}

function resolveAlias(specifier, root, knownFiles, knownDirs, aliases) {
  for (const alias of aliases) {
    const wildcard = alias.pattern.indexOf('*');
    if (wildcard === -1) {
      if (alias.pattern !== specifier) continue;
      if (alias.targets.some((target) => exists(resolveTarget(root, target), knownFiles, knownDirs))) return true;
      continue;
    }
    const prefix = alias.pattern.slice(0, wildcard);
    const suffix = alias.pattern.slice(wildcard + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
    for (const target of alias.targets) {
      const candidate = resolveTarget(root, target.replace('*', middle));
      if (exists(candidate, knownFiles, knownDirs)) return true;
    }
  }
  const rest = specifier.replace(/^(@\/|~\/|@app\/)/, '').replace(/^(\$lib\/?)/, 'lib/');
  for (const candidate of [rest, `src/${rest}`, `app/${rest}`, `src/app/${rest}`]) {
    if (exists(candidate, knownFiles, knownDirs)) return true;
  }
  // Unknown alias convention: do not claim it is broken.
  return !specifier.startsWith('@/') && !specifier.startsWith('~/') && !specifier.startsWith('$lib');
}

function resolveTarget(root, target) {
  return path.posix.normalize(target.replace(/^\.\//, '').replace(/^\//, ''));
}

function resolveLocal(specifier, fromFile, root, knownFiles, knownDirs) {
  const clean = specifier.split('?')[0].split('#')[0];
  if (clean.startsWith('/')) {
    return exists(clean.replace(/^\//, ''), knownFiles, knownDirs);
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), clean)).replace(/^\.\//, '');
  return exists(resolved, knownFiles, knownDirs);
}

function exists(candidate, knownFiles, knownDirs) {
  if (!candidate) return false;
  if (knownFiles.has(candidate)) return true;
  for (const ext of EXTENSIONS) {
    if (knownFiles.has(`${candidate}${ext}`)) return true;
  }
  if (knownDirs.has(candidate)) return true;
  for (const ext of EXTENSIONS) {
    if (knownFiles.has(`${candidate}/index${ext}`)) return true;
  }
  return false;
}

function collectDirs(knownFiles) {
  const dirs = new Set();
  for (const file of knownFiles) {
    const parts = file.split('/');
    parts.pop();
    while (parts.length > 0) {
      dirs.add(parts.join('/'));
      parts.pop();
    }
  }
  return dirs;
}

function collectWorkspaceNames(files) {
  const names = new Set();
  for (const file of files) {
    if (file.base !== 'package.json') continue;
    try {
      const parsed = JSON.parse(file.text);
      if (parsed.name) names.add(parsed.name);
    } catch {
      // ignore malformed nested package.json
    }
  }
  return names;
}

function lineIndex(file, index) {
  return file.text.slice(0, index).split('\n').length - 1;
}

function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '));
}

