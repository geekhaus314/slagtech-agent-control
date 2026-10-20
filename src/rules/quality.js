import { appFiles, apiFiles, forEachMatch, isLikelyUiComponent } from './helpers.js';

const TYPE_SUPPRESSION = /(@ts-ignore|@ts-nocheck|@ts-expect-error\b(?!\s*[:\-]?\s*\S)|as\s+any\b|:\s*any\b|<any>)/g;
const EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const CONSOLE_LOG = /\bconsole\.(log|debug)\s*\(/g;
const BROWSER_ALERT = /\balert\s*\(/g;
const IMG_TAG = /<(img|Image)\b([^>]*)>/g;
const CLICKABLE = /<(div|span)\b([^>]*)>/g;
const ENV_REF = /\b(?:process\.env|import\.meta\.env|Bun\.env)\.([A-Z][A-Z0-9_]*)/g;

export const qualityRules = [
  {
    id: 'type-suppression',
    category: 'quality',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'TypeScript errors suppressed or escaped with any.',
    hint: 'Fix the type or model the real data shape. `any` and @ts-ignore hide exactly the defects this gate exists to catch.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        const matches = [...file.text.matchAll(TYPE_SUPPRESSION)];
        if (matches.length === 0) continue;
        for (const match of matches) {
          ctx.report({ file, index: match.index, message: `Type escape hatch: "${match[0]}".` });
        }
        const anyCount = matches.filter((match) => /any/.test(match[0])).length;
        if (anyCount > (ctx.config.limits?.maxAnyPerFile ?? 12)) {
          ctx.report({
            file,
            line: 1,
            severity: 'error',
            message: `${anyCount} "any" escapes in one file; the data model is not typed.`,
          });
        }
      }
    },
  },
  {
    id: 'empty-catch',
    category: 'quality',
    impact: 'verification',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Errors are caught and silently swallowed.',
    hint: 'Handle, log with context, or rethrow. An empty catch turns failures into invisible broken behavior.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        forEachMatch(file, EMPTY_CATCH, (match) => {
          ctx.report({ file, index: match.index, message: 'Empty catch block swallows the error.' });
        });
      }
    },
  },
  {
    id: 'console-log',
    category: 'quality',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'info', strict: 'warn' },
    description: 'Debug logging or alert() left in the product surface.',
    hint: 'Remove debug output or route it through a real logger. alert() is not UI.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        if (!file.isClient && !isLikelyUiComponent(file) && file.ext !== '.vue' && file.ext !== '.svelte') continue;
        forEachMatch(file, CONSOLE_LOG, (match) => {
          ctx.report({ file, index: match.index, message: 'console.log/debug left in client code.' });
        });
        forEachMatch(file, BROWSER_ALERT, (match) => {
          ctx.report({ file, index: match.index, message: 'alert() used as user feedback.' });
        });
      }
    },
  },
  {
    id: 'missing-alt',
    category: 'quality',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Image tag without alternative text.',
    hint: 'Add descriptive alt text or alt="" with intent. Missing alt breaks screen readers.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isMarkup && !file.isCode) continue;
        for (const match of file.text.matchAll(IMG_TAG)) {
          const attrs = match[2];
          if (/\balt\s*=/.test(attrs)) continue;
          if (/\{\.\.\./.test(attrs)) continue;
          ctx.report({ file, index: match.index, message: `<${match[1]}> has no alt attribute.` });
        }
      }
    },
  },
  {
    id: 'clickable-div',
    category: 'quality',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Non-semantic element used as an interactive control.',
    hint: 'Use a button/link. If a div must be interactive, add role, tabIndex and keyboard handling.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isMarkup && !file.isCode) continue;
        for (const match of file.text.matchAll(CLICKABLE)) {
          const attrs = match[2];
          if (!/\bonClick\b|\bon:click\b|\b@click\b/.test(attrs)) continue;
          const hasRole = /\brole\s*=\s*["'](button|link)["']/.test(attrs);
          const hasKeyboard = /\bonKey(Down|Up|Press)\b/.test(attrs);
          if (hasRole && hasKeyboard) continue;
          ctx.report({
            file,
            index: match.index,
            message: `<${match[1]}> is clickable but ${hasRole ? 'has no keyboard handler' : 'has no button/link semantics'}.`,
          });
        }
      }
    },
  },
  {
    id: 'unhandled-api-errors',
    category: 'quality',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'info', strict: 'warn' },
    description: 'API handler has no error handling around its work.',
    hint: 'Wrap the handler in try/catch and return a real error response. Unhandled failures become opaque 500s.',
    run(ctx) {
      for (const file of apiFiles(ctx)) {
        if (!/\b(POST|PUT|PATCH|DELETE|GET)\b/.test(file.text)) continue;
        if (/\btry\s*\{|\bcatch\s*\(/.test(file.text)) continue;
        if (/\bwithErrorHandler\b|\basyncHandler\b|\bhandleError\b/.test(file.text)) continue;
        ctx.report({ file, line: 1, message: 'API handler has no try/catch or error wrapper.' });
      }
    },
  },
  {
    id: 'missing-tests',
    category: 'process',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Project has application code but no tests.',
    hint: 'Add tests for the core actions. Without tests there is no proof the UI is wired to real behavior.',
    run(ctx) {
      if (ctx.sourceFiles.length === 0 || ctx.testFiles.length > 0) return;
      ctx.report({
        file: 'package.json',
        line: 1,
        message: `No tests found across ${ctx.sourceFiles.length} source file(s).`,
      });
    },
  },
  {
    id: 'missing-verification-command',
    category: 'process',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'No build, typecheck, lint or test script is defined.',
    hint: 'Add runnable scripts. Verification is a command, not a claim in the chat.',
    run(ctx) {
      if (!ctx.packageJson) return;
      const scripts = ctx.packageJson.scripts ?? {};
      const hasAny = ['build', 'typecheck', 'lint', 'test', 'e2e'].some((name) => typeof scripts[name] === 'string');
      if (hasAny) return;
      ctx.report({
        file: 'package.json',
        line: 1,
        message: 'package.json defines no build, typecheck, lint, test or e2e script.',
      });
    },
  },
  {
    id: 'missing-env-example',
    category: 'process',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Environment variables are used but never documented.',
    hint: 'Commit .env.example with placeholder values. Undocumented env vars prevent anyone else from running the app.',
    run(ctx) {
      const example = ctx.files.find((file) => /(^|\/)\.env\.(example|sample|template)$/.test(file.rel));
      if (example) return;
      const names = new Set();
      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        for (const match of file.text.matchAll(ENV_REF)) names.add(match[1]);
      }
      if (names.size === 0) return;
      ctx.report({
        file: '.env.example',
        line: 1,
        message: `${names.size} environment variable(s) used but no .env.example exists (${[...names].slice(0, 6).join(', ')}${names.size > 6 ? ', …' : ''}).`,
      });
    },
  },
  {
    id: 'missing-ci',
    category: 'process',
    impact: 'verification',
    severity: { relaxed: 'off', standard: 'info', strict: 'warn' },
    description: 'No CI workflow runs verification.',
    hint: 'Add a CI job that runs the gate. Unverified local claims do not survive the first push.',
    run(ctx) {
      const ci = ctx.files.find((file) =>
        /^\.github\/workflows\/.*\.ya?ml$/.test(file.rel) ||
        ['.gitlab-ci.yml', 'circle.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'Jenkinsfile', '.buildkite/pipeline.yml'].includes(file.rel),
      );
      if (ci) return;
      ctx.report({ file: '.github/workflows', line: 1, message: 'No CI workflow found.' });
    },
  },
  {
    id: 'oversized-file',
    category: 'quality',
    impact: 'verification',
    severity: { relaxed: 'off', standard: 'info', strict: 'warn' },
    description: 'A single source file has grown beyond a maintainable size.',
    hint: 'Split by responsibility. Giant files usually mean generated code was pasted instead of designed.',
    run(ctx) {
      const limit = ctx.config.limits?.maxFileLines ?? 700;
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isStyle) continue;
        if (file.lineCount <= limit) continue;
        ctx.report({
          file,
          line: limit,
          message: `File has ${file.lineCount} lines (limit ${limit}).`,
        });
      }
    },
  },
];
