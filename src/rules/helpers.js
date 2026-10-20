import path from 'node:path';

export function forEachMatch(file, regex, callback) {
  const global = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
  global.lastIndex = 0;
  let match;
  while ((match = global.exec(file.text)) !== null) {
    callback(match, global.lastIndex);
    if (match[0].length === 0) global.lastIndex += 1;
  }
}

export function appFiles(ctx, { includeDocs = false, includeStyles = false } = {}) {
  return ctx.files.filter((file) => {
    if (file.isGenerated) return false;
    if (file.isTest || file.isFixture) return false;
    if (file.isConfig) return false;
    if (file.isDoc && !includeDocs) return false;
    if (file.isStyle && !includeStyles) return false;
    if (file.isSource) return true;
    if (file.isContent && file.ext === '.mdx' && /(^|\/)(app|pages|src|content)\//.test(file.rel)) return true;
    return false;
  });
}

export function uiFiles(ctx) {
  return appFiles(ctx).filter((file) => file.isMarkup || file.isCode || file.ext === '.mdx');
}

export function serverFiles(ctx) {
  return ctx.files.filter((file) => {
    if (file.isTest || file.isFixture || file.isGenerated) return false;
    const rel = file.rel.toLowerCase();
    return file.isServerDirective || file.isApiPath ||
      /(^|\/)(server|backend|lib\/server|src\/server|actions?)\//.test(rel) ||
      /(^|\/)(route|server|action|actions)\.(js|jsx|ts|tsx)$/.test(rel);
  });
}

export function apiFiles(ctx) {
  const files = new Set(ctx.apiRoutes.map((route) => route.file));
  return [...files]
    .map((rel) => ctx.files.find((file) => file.rel === rel))
    .filter(Boolean)
    .filter((file) => !file.isTest && !file.isGenerated);
}

export function relatedFileText(ctx, file, depth = 2) {
  const seen = new Set();
  const walk = (current, remaining) => {
    if (!current || seen.has(current.rel) || remaining < 0) return '';
    seen.add(current.rel);
    let text = current.text;
    const imports = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const match of current.text.matchAll(imports)) {
      const spec = match[1];
      if (!spec || !spec.startsWith('.')) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(current.rel), spec));
      const found = resolveLocal(ctx.files, base);
      if (found) text += `\n${walk(found, remaining - 1)}`;
    }
    return text;
  };
  return walk(file, depth);
}

function resolveLocal(files, base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`];
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) candidates.push(`${base}/index${ext}`);
  return files.find((entry) => candidates.includes(entry.rel)) ?? null;
}

export function filesMatching(files, pattern) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return files.filter((file) => regex.test(file.text));
}

export function lineCount(file) {
  return file.lines.length;
}

export function isLikelyUiComponent(file) {
  if (!file.isCode && !file.isMarkup) return false;
  return /(^|\/)(components?|app|pages|views|ui|routes|layouts?)\//.test(file.rel) ||
    file.rel.includes('.jsx') || file.rel.includes('.tsx') ||
    file.ext === '.vue' || file.ext === '.svelte' || file.ext === '.astro' || file.ext === '.html';
}

export function commentStripped(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countMatches(text, regex) {
  const global = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
  let count = 0;
  while (global.exec(text) !== null) count += 1;
  return count;
}
