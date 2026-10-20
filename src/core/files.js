import fs from 'node:fs/promises';
import path from 'node:path';
import { createMatcher, matchesAny, normalizePath } from './glob.js';

export const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro']);
export const MARKUP_EXTENSIONS = new Set(['.html', '.htm', '.hbs', '.handlebars', '.ejs', '.pug']);
export const CONTENT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yml', '.yaml']);
export const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', '.nuxt', '.svelte-kit', '.astro', '.turbo', '.vercel',
  '.output', '.netlify', '.cache', 'dist', 'build', 'out', 'coverage', 'vendor', 'target',
  '.venv', 'venv', '__pycache__', '.idea', '.vscode', '.slag', '.pnpm-store', 'tmp', 'temp',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'composer.lock', 'Cargo.lock',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.webm', '.wav', '.ogg',
  '.zip', '.gz', '.tar', '.pdf', '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
  '.sqlite', '.db', '.parquet', '.lock',
]);

const DEFAULT_MAX_BYTES = 1_500_000;
const DEFAULT_MAX_FILES = 20_000;

const ROOT_DOCS = new Set(['readme.md', 'readme.mdx', 'changelog.md', 'contributing.md', 'license.md', 'security.md']);

export async function collectFiles(root, config = {}) {
  const maxBytes = config.limits?.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = config.limits?.maxFiles ?? DEFAULT_MAX_FILES;
  const ignoreMatcher = createMatcher(config.ignore ?? []);
  const includes = config.include ?? ['**/*'];
  const includeMatcher = createMatcher(includes);
  const files = [];
  const warnings = [];
  const packageJson = await readJson(path.join(root, 'package.json'));
  let truncated = false;

  async function walk(dir, relDir = '') {
    if (truncated) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      warnings.push({ code: 'read-dir-failed', message: String(error.message), path: relDir || '.' });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const rel = normalizePath(relDir ? `${relDir}/${entry.name}` : entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.')) {
          if (!['.github', '.cursor', '.windsurf', '.claude', '.opencode', '.continue', '.clinerules', '.roo', '.githooks'].includes(entry.name)) {
            continue;
          }
        }
        if (ignoreMatcher(`${rel}/`)) continue;
        if (ignoreMatcher(rel)) continue;
        await walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        warnings.push({ code: 'max-files', message: `Scanned file limit of ${maxFiles} reached.` });
        return;
      }
      if (SKIP_FILES.has(entry.name)) continue;
      if (/^\.env(\.|$)/.test(entry.name) && !/(example|sample|template|dist)/.test(entry.name)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (/\.min\.(js|css)$/.test(entry.name)) continue;
      if (!includeMatcher(rel)) continue;
      if (ignoreMatcher(rel)) continue;

      const abs = path.join(dir, entry.name);
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        continue;
      }
      if (stat.size > maxBytes) {
        warnings.push({ code: 'file-too-large', message: `Skipped large file (${stat.size} bytes).`, path: rel });
        continue;
      }

      let text;
      try {
        text = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      if (text.includes('\u0000')) continue;

      files.push(makeFile({ rel, abs, ext, text, size: stat.size, mtimeMs: stat.mtimeMs }));
    }
  }

  await walk(root);
  return { files, warnings, packageJson };
}

function makeFile({ rel, abs, ext, text, size, mtimeMs }) {
  const lower = rel.toLowerCase();
  const base = path.basename(lower);
  const segments = lower.split('/');
  const testDir = segments.some((part) =>
    ['test', 'tests', '__tests__', 'e2e', 'cypress', 'playwright', 'spec', 'stories', '__mocks__', 'mocks'].includes(part),
  );
  const testFile = testDir || /\.(test|spec|stories)\.[^.]+$/.test(base);
  const fixtureFile = segments.some((part) => ['fixtures', 'fixture', 'seeds', 'seed', 'examples', 'demo'].includes(part));
  const docFile = CONTENT_EXTENSIONS.has(ext) && (
    ROOT_DOCS.has(base) || segments.includes('docs') || segments.includes('documentation') ||
    (ext === '.md' && segments.length === 1) || segments.includes('.github')
  );
  const code = CODE_EXTENSIONS.has(ext);
  const markup = MARKUP_EXTENSIONS.has(ext);
  const style = STYLE_EXTENSIONS.has(ext);
  const content = CONTENT_EXTENSIONS.has(ext);
  const configFile = /^(package\.json|tsconfig.*\.json|jsconfig.*\.json|vite\.config\..*|next\.config\..*|tailwind\.config\..*|postcss\.config\..*|eslint\.config\..*|\.eslintrc.*|prettier.*|astro\.config\..*|svelte\.config\..*|nuxt\.config\..*|remix\.config\..*|drizzle\.config\..*|prisma\/schema\.prisma|slag\.config\.json)$/i.test(base) ||
    segments.includes('config') || /\.config\.[a-z]+$/i.test(base);
  const generated = segments.includes('generated') || segments.includes('__generated__') || /\.generated\.[^.]+$/.test(base);
  const client = /^\s*(['"])use client\1/.test(text.slice(0, 200));
  const serverDirective = /^\s*(['"])use server\1/.test(text.slice(0, 200));
  const apiPath = /(^|\/)(api|server|functions|workers|routes)\//.test(lower) ||
    /(^|\/)(route|server)\.(js|jsx|ts|tsx)$/.test(lower) ||
    /(^|\/)pages\/api\//.test(lower);
  const source = (code || markup) && !testFile && !fixtureFile && !generated && !configFile;
  const lines = text.split(/\r?\n/);

  return {
    rel, abs, ext, text, size, mtimeMs, base, lines,
    isTest: testFile,
    isFixture: fixtureFile,
    isDoc: docFile,
    isCode: code,
    isMarkup: markup,
    isStyle: style,
    isContent: content,
    isConfig: configFile,
    isGenerated: generated,
    isClient: client,
    isServerDirective: serverDirective,
    isApiPath: apiPath,
    isSource: source,
    lineCount: lines.length,
  };
}

export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

export function columnOf(text, index) {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return index - lineStart + 1;
}

export function excerptAt(text, index, radius = 45) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

export function readFileText(file) {
  return file.text;
}

export async function readJson(absPath) {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isIgnored(rel, config) {
  return matchesAny(rel, config.ignore ?? []);
}
