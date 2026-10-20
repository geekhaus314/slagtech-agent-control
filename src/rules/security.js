import { execFileSync } from 'node:child_process';
import { appFiles, forEachMatch, serverFiles } from './helpers.js';

const SECRET_PATTERNS = [
  { regex: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g, label: 'provider API key' },
  { regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, label: 'Stripe live key' },
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS access key' },
  { regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, label: 'GitHub token' },
  { regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, label: 'GitHub token' },
  { regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g, label: 'Google API key' },
  { regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: 'Slack token' },
  { regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, label: 'private key' },
  { regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, label: 'literal JWT' },
  { regex: /\b(?:api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*['"`][A-Za-z0-9_\-./+]{16,}['"`]/gi, label: 'hardcoded credential' },
];

const SAFE_SECRET = /(process\.env|import\.meta\.env|your[_-]|xxx|placeholder|example|sample|dummy|changeme|replace[_-]?me|redacted|\$\{|<[^>]+>)/i;
const PUBLIC_SENSITIVE = /\b(NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_)[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|ADMIN|PASSWORD|DATABASE_URL|JWT|SIGNING)[A-Z0-9_]*\b/g;
const SQL_INJECTION = /\b(?:query|execute|raw|unsafe)\s*\(\s*`[^`]*\$\{/g;
const SQL_CONCAT = /\b(?:query|execute|raw)\s*\(\s*['"][^'"]*(?:SELECT|INSERT|UPDATE|DELETE)[^'"]*['"]\s*\+/gi;
const DANGEROUS_HTML = /\b(dangerouslySetInnerHTML|innerHTML\s*=|insertAdjacentHTML|v-html|\{@html)/g;
const EVAL = /\b(eval\s*\(|new\s+Function\s*\()/g;
const CORS_WILDCARD = /(Access-Control-Allow-Origin['"`]?\s*[:,]\s*['"`]\*['"`]|origin\s*:\s*['"`]\*['"`])/gi;
const HTTP_URL = /\b(?:fetch|axios\.(?:get|post|put|patch|delete)|src|href)\s*[=(]\s*['"`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)([^'"`\s]+)['"`]/gi;
const TARGET_BLANK = /<a\b[^>]*target\s*=\s*["']_blank["'][^>]*>/gi;
const NOOPENER = /\brel\s*=\s*["'][^"']*noopener/i;

export const securityRules = [
  {
    id: 'committed-env',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'error', standard: 'error', strict: 'error' },
    description: 'A real environment file is committed to git.',
    hint: 'Remove the file from git, rotate every secret it contained, and commit only an .env.example with placeholder values.',
    run(ctx) {
      const tracked = gitTrackedFiles(ctx.root);
      if (!tracked) return;
      for (const file of tracked) {
        const base = file.split('/').pop();
        if (/^\.env(\.|$)/.test(base) && !/(example|sample|template)/.test(base)) {
          ctx.report({
            file,
            line: 1,
            message: `${file} is tracked by git and may contain real secrets.`,
          });
        }
      }
    },
  },
  {
    id: 'hardcoded-secret',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'error', standard: 'error', strict: 'error' },
    description: 'A credential or private key appears to be hardcoded in the repository.',
    hint: 'Move the value to a server-side environment variable and rotate it. Do not paste keys into source or client bundles.',
    run(ctx) {
      for (const file of ctx.files) {
        if (file.isTest || file.isFixture || file.isGenerated) continue;
        if (/\.(map|lock)$/.test(file.rel)) continue;
        for (const pattern of SECRET_PATTERNS) {
          forEachMatch(file, pattern.regex, (match) => {
            if (SAFE_SECRET.test(match[0])) return;
            ctx.report({
              file,
              index: match.index,
              message: `Possible ${pattern.label} hardcoded in source.`,
              data: { label: pattern.label },
            });
          });
        }
      }
    },
  },
  {
    id: 'public-secret',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'error', standard: 'error', strict: 'error' },
    description: 'A sensitive environment variable is exposed to the client bundle.',
    hint: 'Remove the public prefix and read the value only on the server. Anything prefixed for the client is shipped to every visitor.',
    run(ctx) {
      for (const file of ctx.files) {
        if (file.isTest || file.isFixture) continue;
        forEachMatch(file, PUBLIC_SENSITIVE, (match) => {
          ctx.report({
            file,
            index: match.index,
            message: `Sensitive value exposed via public env var "${match[0]}".`,
            data: { name: match[0] },
          });
        });
      }
    },
  },
  {
    id: 'sql-injection',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'error', standard: 'error', strict: 'error' },
    description: 'SQL query built with string interpolation or concatenation.',
    hint: 'Use parameterized queries or the ORM query builder. Interpolating request data into SQL is an injection.',
    run(ctx) {
      for (const file of serverFiles(ctx)) {
        for (const regex of [SQL_INJECTION, SQL_CONCAT]) {
          forEachMatch(file, regex, (match) => {
            ctx.report({ file, index: match.index, message: 'SQL built with interpolated or concatenated input.' });
          });
        }
      }
    },
  },
  {
    id: 'dangerous-html',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Raw HTML injection without an obvious sanitization step.',
    hint: 'Sanitize untrusted HTML (DOMPurify or equivalent) or render structured content instead. Raw HTML is an XSS path.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        forEachMatch(file, DANGEROUS_HTML, (match) => {
          const around = file.text.slice(Math.max(0, match.index - 200), match.index + 220);
          if (/\b(sanitize|DOMPurify|purify|escapeHtml)\b/i.test(around)) return;
          ctx.report({ file, index: match.index, message: 'Raw HTML injection without visible sanitization.' });
        });
      }
    },
  },
  {
    id: 'eval-usage',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Dynamic code evaluation in application code.',
    hint: 'Remove eval/new Function. Use structured parsing or a lookup table instead.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        forEachMatch(file, EVAL, (match) => {
          ctx.report({ file, index: match.index, message: 'Dynamic code evaluation (eval / new Function).' });
        });
      }
    },
  },
  {
    id: 'cors-wildcard',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'API allows any origin.',
    hint: 'Allow-list the real origins. Wildcard CORS on authenticated APIs lets any site call them.',
    run(ctx) {
      for (const file of ctx.files) {
        if (file.isTest || file.isFixture || file.isGenerated) continue;
        forEachMatch(file, CORS_WILDCARD, (match) => {
          ctx.report({ file, index: match.index, message: 'Wildcard CORS origin configured.' });
        });
      }
    },
  },
  {
    id: 'insecure-http',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'warn' },
    description: 'Plain HTTP URL used for a non-local resource.',
    hint: 'Use HTTPS. Plain HTTP leaks data and triggers mixed-content blocking in production.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        forEachMatch(file, HTTP_URL, (match) => {
          if (/^(www\.)?w3\.org|schema\.org|localhost|127\.0\.0\.1/.test(match[1])) return;
          ctx.report({ file, index: match.index, message: `Plain HTTP resource: "${match[1]}".` });
        });
      }
    },
  },
  {
    id: 'target-blank-noopener',
    category: 'quality',
    impact: 'security',
    severity: { relaxed: 'off', standard: 'info', strict: 'warn' },
    description: 'New-tab link without rel="noopener".',
    hint: 'Add rel="noopener noreferrer" to external links opened in a new tab.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isMarkup && !file.isCode) continue;
        for (const match of file.text.matchAll(TARGET_BLANK)) {
          if (NOOPENER.test(match[0])) continue;
          ctx.report({ file, index: match.index, message: 'target="_blank" link without rel="noopener".' });
        }
      }
    },
  },
];

function gitTrackedFiles(root) {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}
