import { appFiles, apiFiles, forEachMatch, relatedFileText, serverFiles } from './helpers.js';
import { hasAuthCheck, hasDataAccess, hasSideEffect, hasValidation } from '../core/analyze.js';

const MUTATION_METHOD = /\b(?:export\s+(?:async\s+)?(?:function\s+)?(POST|PUT|PATCH|DELETE)\b|(?:app|router|server)\.(post|put|patch|delete)\s*\()/g;
const INPUT_READ = /\b(await\s+)?(request|req)\.(json|formData|text|body)\b|\bawait\s+request\.formData\s*\(|\b(searchParams|params|query)\b|\bawait\s+params\b/;
const STATIC_RESPONSE = /\b(?:return\s+)?(?:NextResponse|Response)\.json\s*\(\s*(\[[\s\S]{0,120}\]|\{[\s\S]{0,120}\}|[A-Z][A-Z0-9_]{2,})\s*[,)]|\bres\.(?:json|send)\s*\(\s*(\[[\s\S]{0,120}\]|\{[\s\S]{0,120}\}|[A-Z][A-Z0-9_]{2,})\s*\)/;
const IN_MEMORY = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(new\s+(?:Map|Set)\s*(?:<[^>]*>)?\s*\(\s*\)|\[\s*\]|\{\s*\})\s*;?\s*$/gm;
const HARDCODED_CREDENTIALS = /(password|passwd|pwd)\s*[:=]\s*['"`](admin|password|123456|letmein|changeme|secret|test)['"`]/gi;
const PASSWORD_COMPARE = /(password|passwd)\s*===?\s*['"`][^'"`]+['"`]/gi;
const CLIENT_AUTH_REDIRECT = /(?:if\s*\(\s*!(?:user|session|isAuthenticated|auth)\s*\)[\s\S]{0,160}?(?:router\.(?:push|replace)|window\.location|redirect)\s*\(\s*['"`]\/?(login|signin|sign-in|auth)['"`]|useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,240}?(?:router\.(?:push|replace)|window\.location)\s*\(\s*['"`]\/?(login|signin|sign-in|auth)['"`])/gi;
const JWT_DECODE = /\b(jwtDecode|jwt\.decode|decodeJwt|parseJwt)\s*\(/gi;
const DOCUMENT_COOKIE_AUTH = /document\.cookie\s*=\s*[^;\n]*(token|session|auth|user|jwt)/gi;

export const backendRules = [
  {
    id: 'mutation-without-side-effect',
    category: 'backend',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Write endpoint that changes nothing and persists nothing.',
    hint: 'A mutation must have an observable effect: database write, external API call, file/storage write, or queued job. Returning success is not an implementation.',
    run(ctx) {
      for (const file of apiFiles(ctx)) {
        const text = relatedFileText(ctx, file);
        if (!MUTATION_METHOD.test(text)) {
          MUTATION_METHOD.lastIndex = 0;
          continue;
        }
        MUTATION_METHOD.lastIndex = 0;
        if (hasSideEffect(text)) continue;
        ctx.report({
          file,
          line: 1,
          message: 'Mutation handler has no persistence or side effect.',
          hint: 'Implement the write path. This endpoint currently accepts a request and pretends it worked.',
        });
      }
    },
  },
  {
    id: 'static-api-response',
    category: 'backend',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'GET endpoint returns hardcoded data instead of reading a source.',
    hint: 'Replace the literal response with a real query or upstream call. Hardcoded JSON is a mock dressed as an API.',
    run(ctx) {
      for (const file of apiFiles(ctx)) {
        const text = relatedFileText(ctx, file);
        if (/\b(POST|PUT|PATCH|DELETE)\b/.test(text)) continue;
        if (hasDataAccess(text) || /\bfetch\s*\(|\baxios\b|\breadFile\b|\bcache\b/i.test(text)) continue;
        if (/\/(health|healthz|ping|status|ready|version|config)\b/.test(file.rel)) continue;
        const match = text.match(STATIC_RESPONSE);
        if (!match) continue;
        ctx.report({
          file,
          index: match.index,
          message: 'GET handler returns hardcoded data with no data source.',
        });
      }
    },
  },
  {
    id: 'unvalidated-mutation',
    category: 'backend',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Mutation reads request input without runtime validation.',
    hint: 'Validate input at the boundary (zod, valibot, joi, manual checks). TypeScript types disappear at runtime and are not validation.',
    run(ctx) {
      for (const file of apiFiles(ctx)) {
        const text = relatedFileText(ctx, file);
        if (!MUTATION_METHOD.test(text)) {
          MUTATION_METHOD.lastIndex = 0;
          continue;
        }
        MUTATION_METHOD.lastIndex = 0;
        if (!INPUT_READ.test(text)) continue;
        if (hasValidation(text)) continue;
        ctx.report({ file, line: 1, message: 'Mutation reads request input with no runtime validation.' });
      }
    },
  },
  {
    id: 'unauthenticated-mutation',
    category: 'backend',
    impact: 'security',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Sensitive mutation has no server-side authorization check.',
    hint: 'Authorize on the server before mutating user, account, admin or billing data. Hiding the button is not authorization.',
    run(ctx) {
      const hasAuthSystem = Boolean(ctx.framework.auth) || ctx.files.some((file) => /(^|\/)(auth|middleware)\.(js|jsx|ts|tsx)$/.test(file.rel));
      if (!hasAuthSystem) return;
      for (const file of apiFiles(ctx)) {
        const text = relatedFileText(ctx, file);
        if (!MUTATION_METHOD.test(text)) {
          MUTATION_METHOD.lastIndex = 0;
          continue;
        }
        MUTATION_METHOD.lastIndex = 0;
        if (hasAuthCheck(text)) continue;
        const sensitive = /\/(admin|users?|accounts?|profile|billing|payments?|settings|orders?|delete|invite|roles?)\b/i.test(file.rel);
        if (!sensitive) continue;
        ctx.report({ file, line: 1, message: 'Sensitive mutation has no server-side auth check.' });
      }
    },
  },
  {
    id: 'in-memory-store',
    category: 'backend',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Server keeps application state in a process-local array/map.',
    hint: 'Use a real datastore. In-memory state disappears on restart, is not shared across instances, and is not production infrastructure.',
    run(ctx) {
      for (const file of serverFiles(ctx)) {
        if (hasDataAccess(file.text)) continue;
        const match = file.text.match(IN_MEMORY);
        if (!match) continue;
        const around = file.text.slice(Math.max(0, match.index - 80), match.index + match[0].length + 300);
        if (!/\b(POST|PUT|PATCH|DELETE|push|set\(|delete|splice|\.set\b)\b/.test(around) && !/\b(store|db|data|items|users|posts|todos|orders)\b/i.test(match[1])) continue;
        ctx.report({
          file,
          index: match.index,
          message: `Process-local store "${match[1]}" used for application state.`,
        });
      }
    },
  },
  {
    id: 'database-without-schema',
    category: 'process',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Database client installed without a schema or migrations.',
    hint: 'Commit the schema and migration workflow. A database dependency with no schema is an unfinished data layer.',
    run(ctx) {
      if (!ctx.framework.orm && !ctx.framework.database) return;
      const schema = ctx.files.find((file) =>
        /((^|\/)schema\.prisma$|(^|\/)schema\.(ts|js)$|drizzle\.config\.|(^|\/)migrations?\/)/.test(file.rel) ||
        (file.ext === '.sql' && /(migration|schema|init)/i.test(file.rel)),
      );
      if (schema) return;
      ctx.report({
        file: 'package.json',
        line: 1,
        message: `Database stack detected (${ctx.framework.orm ?? ctx.framework.database}) but no schema or migrations found.`,
      });
    },
  },
  {
    id: 'no-durable-storage',
    category: 'backend',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Writes exist but the project has no durable data layer.',
    hint: 'Add a real datastore (database, KV, object storage) or remove the write surfaces. State held in memory or on the client is not persistence.',
    run(ctx) {
      const mutations = apiFiles(ctx).filter((file) => /\b(POST|PUT|PATCH|DELETE)\b/.test(file.text));
      if (mutations.length === 0) return;
      const dataAccess = ctx.files.some((file) => (file.isCode || file.isServerDirective || file.isApiPath) && !file.isTest && !file.isFixture && hasDataAccess(file.text));
      const storageDep = Boolean(ctx.framework.orm || ctx.framework.database) || ctx.hasDependency(['redis', '@vercel/kv', 'ioredis', '@upstash/redis', 'firebase', '@aws-sdk/client-s3', '@cloudflare/workers-types']);
      if (dataAccess || storageDep) return;
      ctx.report({
        file: mutations[0].rel,
        line: 1,
        message: `${mutations.length} write endpoint(s) but no database, KV, file storage or upstream persistence detected.`,
      });
    },
  },
  {
    id: 'fake-auth',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'error', standard: 'error', strict: 'error' },
    description: 'Authentication implemented with client-side storage, hardcoded credentials or string comparisons.',
    hint: 'Use a real auth library with server-verified sessions. Client-side flags and literal password comparisons are not authentication.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        for (const [regex, message] of [
          [HARDCODED_CREDENTIALS, 'Hardcoded credential found in source.'],
          [PASSWORD_COMPARE, 'Password compared against a literal instead of a verified hash.'],
          [DOCUMENT_COOKIE_AUTH, 'Auth token written to a cookie from client code.'],
          [JWT_DECODE, 'JWT decoded in application code; decoding is not verification.'],
        ]) {
          forEachMatch(file, regex, (match) => {
            ctx.report({ file, index: match.index, message });
          });
        }
        if (/\b(localStorage|sessionStorage)\.setItem\s*\(\s*['"`](token|auth|session|jwt|user)['"`]/i.test(file.text)) {
          const match = file.text.match(/\b(localStorage|sessionStorage)\.setItem\s*\(\s*['"`](token|auth|session|jwt|user)['"`]/i);
          ctx.report({ file, index: match?.index, message: 'Auth state stored in browser storage instead of a server-verified session.' });
        }
      }
    },
  },
  {
    id: 'client-only-auth-guard',
    category: 'security',
    impact: 'security',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Protected routes guarded only by a client-side redirect.',
    hint: 'Protect the route on the server (middleware, layout check, or per-request session check). Client redirects can be bypassed and flash protected UI.',
    run(ctx) {
      const serverGuard = ctx.files.some((file) =>
        /(^|\/)middleware\.(js|ts)$/.test(file.rel) ||
        (/(^|\/)(auth|session)\.(js|ts)$/.test(file.rel) && /(getServerSession|requireAuth|requireUser|auth\s*\()/.test(file.text)),
      );
      if (serverGuard) return;
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        forEachMatch(file, CLIENT_AUTH_REDIRECT, (match) => {
          ctx.report({
            file,
            index: match.index,
            message: 'Route protection is a client-side redirect with no server-side guard.',
          });
        });
      }
    },
  },
];
