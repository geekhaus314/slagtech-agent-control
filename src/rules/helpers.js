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

const PURE_CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const HYBRID_EXTENSIONS = new Set(['.svelte', '.vue', '.astro']);

/** Files where markup tags only ever exist inside JS literals, never as code. */
export function isPureCodeFile(file) {
  return file.isCode && PURE_CODE_EXTENSIONS.has(file.ext) && !HYBRID_EXTENSIONS.has(file.ext);
}

/**
 * Offsets-preserving literal blanking for pure JS/TS sources.
 * Replaces the interior of comments, single/double-quoted strings and regex
 * literals with spaces, so match.index keeps pointing at the same location
 * in the original text. Used by markup-tag scanners: in vanilla code files,
 * a tag inside a string or regex is detection logic, not shipped markup.
 */
export function maskCodeLiterals(text) {
  const out = text.split('');
  const len = text.length;
  let i = 0;
  let state = 'code'; // code | lineComment | blockComment | single | double | regex
  let inRegexClass = false;

  while (i < len) {
    const ch = text[i];
    const next = text[i + 1];

    if (state === 'lineComment') {
      if (ch === '\n') state = 'code';
      else out[i] = ' ';
      i += 1;
      continue;
    }
    if (state === 'blockComment') {
      if (ch === '*' && next === '/') { out[i] = ' '; out[i + 1] = ' '; state = 'code'; i += 2; continue; }
      if (ch !== '\n') out[i] = ' ';
      i += 1;
      continue;
    }
    if (state === 'single' || state === 'double') {
      if (ch === '\\') { out[i] = ' '; if (i + 1 < len) out[i + 1] = ' '; i += 2; continue; }
      if (ch !== '\n') out[i] = ' ';
      if (ch === '\n') state = 'code';
      else if (state === 'single' && ch === "'") state = 'code';
      else if (state === 'double' && ch === '"') state = 'code';
      i += 1;
      continue;
    }
    if (state === 'regex') {
      if (inRegexClass) {
        if (ch === '\\') { out[i] = ' '; if (i + 1 < len) out[i + 1] = ' '; i += 2; continue; }
        if (ch === ']') inRegexClass = false;
        out[i] = ' ';
        i += 1;
        continue;
      }
      if (ch === '\\') { out[i] = ' '; if (i + 1 < len) out[i + 1] = ' '; i += 2; continue; }
      if (ch === '[') { inRegexClass = true; out[i] = ' '; i += 1; continue; }
      if (ch === '/') {
        let j = i + 1;
        while (j < len && /[dgimsuvy]/.test(text[j])) { out[j] = ' '; j += 1; }
        inRegexClass = false;
        state = 'code';
        i = j;
        continue;
      }
      if (ch !== '\n') out[i] = ' ';
      i += 1;
      continue;
    }
    // state === 'code'
    if (ch === '/' && next === '/') { state = 'lineComment'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
    if (ch === '/' && next === '*') { state = 'blockComment'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue; }
    if (ch === "'") { state = 'single'; out[i] = ' '; i += 1; continue; }
    if (ch === '"') { state = 'double'; out[i] = ' '; i += 1; continue; }
    if (ch === '/' && regexOpenerBefore(out, i)) { state = 'regex'; out[i] = ' '; i += 1; continue; }
    i += 1;
  }
  return out.join('');
}

/** Is the nearest non-space character before position i one that starts a regex literal? */
function regexOpenerBefore(out, position) {
  for (let k = position - 1; k >= 0; k -= 1) {
    const ch = out[k];
    if (ch === ' ' || ch === '\t' || ch === '\n') continue;
    if (ch === '\n') {
      // allow regex after "= new RegExp" etc. only if previous line's last char qualifies
      continue;
    }
    return '([{,;:!&|?=<>+-%*/~^'.includes(ch);
  }
  return true;
}

/**
 * Copy-scan mask for content rules running on code files: blank lines that
 * are detection machinery rather than shipped copy — comments, regex
 * literals, single-string marker-array elements, .includes/.test/.match
 * calls, and finding(...)/findings.push(...) statements. Line-scoped by
 * design: product copy living in template literals or object strings stays
 * fully visible, because that text genuinely ships to users.
 */
export function copyScanContext(file) {
  if (!file.isCode || HYBRID_EXTENSIONS.has(file.ext)) return file.text;
  const out = [];
  let inBlockComment = false;
  for (const line of file.text.split('\n')) {
    const trimmed = line.trim();
    if (inBlockComment) {
      const endIdx = trimmed.indexOf('*/');
      if (endIdx === -1) {
        out.push(''.padEnd(line.length, ' '));
        continue;
      }
      inBlockComment = false;
      const rest = trimmed.slice(endIdx + 2);
      if (rest === '') {
        out.push(''.padEnd(line.length, ' '));
      } else {
        const offset = line.length - rest.length;
        out.push(''.padEnd(offset, ' ') + (isMachineryCopyLine(rest) ? ''.padEnd(rest.length, ' ') : rest));
      }
      continue;
    }
    if (trimmed.startsWith('/*')) {
      const endIdx = trimmed.indexOf('*/', 2);
      if (endIdx === -1) {
        inBlockComment = true;
        out.push(''.padEnd(line.length, ' '));
      } else {
        out.push(''.padEnd(line.length, ' '));
      }
      continue;
    }
    if (isMachineryCopyLine(trimmed)) {
      out.push(''.padEnd(line.length, ' '));
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function isMachineryCopyLine(trimmed) {
  if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*')) return true;
  if (isMarkerArrayElement(trimmed)) return true;
  if (isRegexLiteralLine(trimmed)) return true;
  if (/\.(includes|test|match|matchAll)\s*\(/.test(trimmed)) return true;
  if (/\bfinding\s*\(|\bfindings\s*\.\s*push\s*\(/.test(trimmed)) return true;
  return false;
}

function isMarkerArrayElement(trimmed) {
  return /^(['"`])[^'"`]*\1,?\s*$/.test(trimmed);
}

function isRegexLiteralLine(trimmed) {
  return /(?:=|return|\(|,|:|!)\/[^/]+\/[dgimsuvy]*\s*[),;:]?$/.test(trimmed) && !/^\(?\/\d/.test(trimmed);
}

/**
 * Blank single- and double-quoted string interiors (and comments and regex
 * literals) for a code file, keeping offsets. Used by markup-tag scanners.
 */
export function tagScanText(file) {
  if (!isPureCodeFile(file)) return file.text;
  return maskCodeLiterals(file.text);
}
