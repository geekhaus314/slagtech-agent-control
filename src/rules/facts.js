import { createMatcher } from '../core/glob.js';
import { serverFiles } from './helpers.js';

const DB_DEPS = ['prisma', '@prisma/client', 'drizzle-orm', 'knex', 'sequelize', 'typeorm', 'mongoose', 'mongodb', 'pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres', 'mysql2', 'mysql', 'better-sqlite3', 'sqlite3', '@supabase/supabase-js', 'firebase', 'firebase-admin', 'redis', 'ioredis', '@upstash/redis', '@planetscale/database', 'libsql', '@libsql/client'];
const AUTH_DEPS = ['next-auth', '@auth/core', '@auth/nextjs', 'better-auth', 'lucia', '@clerk/nextjs', '@clerk/clerk-react', 'auth0', '@auth0/nextjs-auth0', 'passport', '@supabase/supabase-js', 'firebase', 'firebase-admin', 'jsonwebtoken', 'jose', 'bcrypt', 'bcryptjs'];
const PAYMENT_DEPS = { stripe: ['stripe', '@stripe/stripe-js'], paddle: ['@paddle/paddle-node-sdk', '@paddle/paddle-js'], 'lemon squeezy': ['@lemonsqueezy/lemonsqueezy.js'], lemonsqueezy: ['@lemonsqueezy/lemonsqueezy.js'] };
const DEPLOYMENT_MARKERS = {
  vercel: ['vercel.json', '.vercel/project.json'],
  netlify: ['netlify.toml'],
  cloudflare: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'],
  fly: ['fly.toml'],
  'fly.io': ['fly.toml'],
  railway: ['railway.json', 'railway.toml'],
  render: ['render.yaml', 'render.yml'],
  docker: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'],
  aws: ['serverless.yml', 'serverless.yaml', 'samconfig.toml', 'cdk.json', 'amplify.yml'],
};

export const factRules = [
  {
    id: 'facts-missing',
    category: 'contract',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'No facts contract exists, so the agent is guessing at requirements.',
    hint: 'Run `slag brief` and ask the user the listed questions. Fill slag.facts.json with confirmed answers before building.',
    run(ctx) {
      if (!ctx.factsEnabled || !ctx.factsMissing) return;
      ctx.report({
        file: ctx.factsFile,
        line: 1,
        message: `No facts contract found at ${ctx.factsFile}.`,
        hint: 'Requirements are unknown. Ask the user for stack, scope, data, auth, deployment and acceptance criteria before writing code.',
      });
    },
  },
  {
    id: 'facts-unconfirmed',
    category: 'contract',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Required facts are unknown or assumed instead of confirmed by the user.',
    hint: 'Ask the user. Do not pick a stack, data model or auth model on their behalf. Record the answer and mark the fact confirmed.',
    run(ctx) {
      if (!ctx.factsEnabled || ctx.factsMissing) return;
      for (const fact of ctx.facts) {
        if (!fact.required || fact.status === 'confirmed') continue;
        const location = locateFact(ctx, fact.id);
        if (fact.status === 'unknown') {
          ctx.report({
            ...location,
            severity: ctx.config.strictness === 'relaxed' ? 'warn' : 'error',
            message: `Required fact "${fact.id}" is unknown. Ask: ${fact.question}`,
            data: { fact: fact.id, status: fact.status },
          });
        } else {
          ctx.report({
            ...location,
            severity: ctx.deliveryMode === 'production' ? 'error' : 'warn',
            message: `Required fact "${fact.id}" is assumed (${fact.value}), not confirmed. Source: ${fact.source ?? 'unknown'}.`,
            data: { fact: fact.id, status: fact.status },
          });
        }
      }
    },
  },
  {
    id: 'facts-evidence-missing',
    category: 'contract',
    impact: 'verification',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'A confirmed fact has evidence patterns but no matching file.',
    hint: 'Implement and prove the fact, or correct the fact. A confirmed requirement with no evidence is a claim.',
    run(ctx) {
      if (!ctx.factsEnabled || ctx.factsMissing) return;
      for (const fact of ctx.facts) {
        if (fact.status !== 'confirmed' || fact.evidence.length === 0) continue;
        const matchers = fact.evidence.map((pattern) => createMatcher([pattern]));
        const matched = ctx.files.filter((file) => matchers.some((matcher) => matcher(file.rel)));
        if (matched.length > 0) continue;
        const location = locateFact(ctx, fact.id);
        ctx.report({
          ...location,
          severity: fact.required ? undefined : 'info',
          message: `Fact "${fact.id}" has no evidence matching ${fact.evidence.join(', ')}.`,
          data: { fact: fact.id, evidence: fact.evidence },
        });
      }
    },
  },
  {
    id: 'fact-drift',
    category: 'hallucination',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'The implementation contradicts a confirmed stack, data, auth, payment or deployment fact.',
    hint: 'Either implement the fact as confirmed or ask the user to change the fact. Silently swapping the stack is not allowed.',
    run(ctx) {
      if (!ctx.factsEnabled || ctx.factsMissing) return;
      checkFrontend(ctx);
      checkBackend(ctx);
      checkDatabase(ctx);
      checkAuth(ctx);
      checkPayments(ctx);
      checkDeployment(ctx);
      checkEntities(ctx);
    },
  },
];

function fact(ctx, id) {
  return ctx.facts.find((entry) => entry.id === id);
}

function valueOf(ctx, id) {
  const entry = fact(ctx, id);
  if (!entry || !entry.value) return '';
  return Array.isArray(entry.value) ? entry.value.join(', ') : String(entry.value);
}

function report(ctx, id, message) {
  const location = locateFact(ctx, id);
  ctx.report({ ...location, message, data: { fact: id } });
}

function checkFrontend(ctx) {
  if (!ctx.packageJson) return;
  const value = valueOf(ctx, 'stack.frontend').toLowerCase();
  if (!value || /\bnone\b/.test(value)) return;
  const checks = [
    [/\bnext(?:\.js)?\b/, ['next'], 'Next.js'],
    [/\bnuxt\b/, ['nuxt'], 'Nuxt'],
    [/\bsveltekit\b/, ['@sveltejs/kit'], 'SvelteKit'],
    [/\bsvelte\b/, ['svelte', '@sveltejs/kit'], 'Svelte'],
    [/\bastro\b/, ['astro'], 'Astro'],
    [/\bremix\b/, ['@remix-run/react', '@remix-run/node'], 'Remix'],
    [/\bangular\b/, ['@angular/core'], 'Angular'],
    [/\bvue\b/, ['vue', 'nuxt'], 'Vue'],
    [/\bsolid\b/, ['solid-js'], 'Solid'],
    [/\breact\b/, ['react', 'next'], 'React'],
  ];
  for (const [regex, deps, label] of checks) {
    if (!regex.test(value)) continue;
    if (ctx.hasDependency(deps)) return;
    report(ctx, 'stack.frontend', `Fact says ${label}, but ${deps.join(' / ')} is not declared in package.json.`);
    return;
  }
}

function checkBackend(ctx) {
  const value = valueOf(ctx, 'stack.backend').toLowerCase();
  if (!value) return;
  if (/\bnone\b|\bstatic\b/.test(value)) {
    if (ctx.apiRoutes.length > 0) {
      report(ctx, 'stack.backend', `Fact says no backend, but ${ctx.apiRoutes.length} API route(s) exist.`);
    }
    return;
  }
  const checks = [
    [/\bnext(?:\.js)?\b/, ['next'], 'Next.js'],
    [/\bexpress\b/, ['express'], 'Express'],
    [/\bfastify\b/, ['fastify'], 'Fastify'],
    [/\bhono\b/, ['hono'], 'Hono'],
    [/\bkoa\b/, ['koa'], 'Koa'],
    [/\bnest\b/, ['@nestjs/core'], 'NestJS'],
    // Workers run through bindings with no runtime dependency; the adapter,
    // wrangler (CLI/deploys) or a wrangler config at any depth are the markers.
    [/\bcloudflare\b/, ['wrangler', '@cloudflare/workers-types', '@sveltejs/adapter-cloudflare', '@cloudflare/vite-plugin'], 'Cloudflare Workers'],
    [/\bpages\b.*\bcloudflare\b/, ['wrangler', '@sveltejs/adapter-cloudflare'], 'Cloudflare Workers'],
    [/\bsupabase\b/, ['@supabase/supabase-js'], 'Supabase'],
    [/\bfirebase\b/, ['firebase', 'firebase-admin'], 'Firebase'],
  ];
  for (const [regex, deps, label] of checks) {
    if (!regex.test(value)) continue;
    // A wrangler.toml/jsonc anywhere under the repo is the deployment + config signal.
    const configMarker = label === 'Cloudflare Workers' && ctx.files.some((file) => /(^|\/)wrangler\.(toml|jsonc?|json)$/.test(file.rel));
    if (ctx.hasDependency(deps) || configMarker) return;
    report(ctx, 'stack.backend', `Fact says ${label}, but no matching dependency or config was found.`);
    return;
  }
}

/** Wrangler config text for D1/SQLite binding detection (any repo depth). */
function cloudflareConfigText(ctx) {
  return ctx.files
    .filter((file) => /(^|\/)wrangler\.(toml|jsonc?|json)$/.test(file.rel))
    .map((file) => file.text)
    .join('\n');
}

/** True when the project declares a Cloudflare D1 binding: in wrangler config
 *  or in code that uses the D1Database binding type. D1 intentionally has no
 *  driver dependency — it is accessed through a Worker binding. */
function hasCloudflareD1(ctx) {
  const config = cloudflareConfigText(ctx);
  if (/\bd1_databases?\b/i.test(config)) return true;
  return ctx.files.some((file) => !file.isTest && !file.isFixture && file.isCode && file.text.includes('D1Database'));
}

function checkDatabase(ctx) {
  const value = valueOf(ctx, 'stack.database').toLowerCase();
  if (!value) return;
  const hasDb = ctx.hasDependency(DB_DEPS);
  if (/\bnone\b/.test(value)) {
    if (hasDb) report(ctx, 'stack.database', 'Fact says no database, but database/ORM dependencies are installed.');
    return;
  }
  // Cloudflare D1 is a SQLite database accessed through a Worker binding:
  // there is deliberately no driver dependency, so look for the binding.
  if (/\bd1\b/.test(value) && hasCloudflareD1(ctx)) return;
  const checks = [
    [/\bprisma\b/, ['prisma', '@prisma/client'], 'Prisma'],
    [/\bdrizzle\b/, ['drizzle-orm'], 'Drizzle'],
    [/\bpostgres/, ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres', 'prisma', '@prisma/client', 'drizzle-orm', '@supabase/supabase-js', '@planetscale/database'], 'PostgreSQL'],
    [/\bmysql\b/, ['mysql2', 'mysql', 'prisma', '@prisma/client', 'drizzle-orm'], 'MySQL'],
  ];
  for (const [regex, deps, label] of checks) {
    if (!regex.test(value)) continue;
    if (ctx.hasDependency(deps)) return;
    report(ctx, 'stack.database', `Fact says ${label}, but no matching driver/ORM is declared.`);
    return;
  }
  if (/\bsqlite\b/.test(value)) {
    if (ctx.hasDependency(['better-sqlite3', 'sqlite3', 'libsql', '@libsql/client', 'prisma', '@prisma/client', 'drizzle-orm'])) return;
    if (hasCloudflareD1(ctx)) return;
    report(ctx, 'stack.database', 'Fact says SQLite, but no driver/ORM or Cloudflare D1 binding was found.');
    return;
  }
  for (const [regex, deps, label] of [
    [/\bmongo(db)?\b/, ['mongodb', 'mongoose', 'prisma', '@prisma/client'], 'MongoDB'],
    [/\bsupabase\b/, ['@supabase/supabase-js'], 'Supabase'],
    [/\bfire(base|store)\b/, ['firebase', 'firebase-admin'], 'Firestore'],
    [/\bredis\b/, ['redis', 'ioredis', '@upstash/redis'], 'Redis'],
  ]) {
    if (!regex.test(value)) continue;
    if (ctx.hasDependency(deps)) return;
    report(ctx, 'stack.database', `Fact says ${label}, but no matching driver/ORM is declared.`);
    return;
  }
  if (!hasDb) report(ctx, 'stack.database', 'A database is required by the facts, but no database/ORM dependency exists.');
}

function checkAuth(ctx) {
  const value = valueOf(ctx, 'auth.model').toLowerCase();
  if (!value) return;
  const hasAuth = ctx.hasDependency(AUTH_DEPS) || ctx.files.some((file) => /(^|\/)(auth|session)\.(js|jsx|ts|tsx)$/.test(file.rel));
  if (/\bnone\b/.test(value)) {
    if (hasAuth) report(ctx, 'auth.model', 'Fact says no auth, but auth dependencies or auth modules exist.');
    return;
  }
  const checks = [
    [/\bclerk\b/, ['@clerk/nextjs', '@clerk/clerk-react'], 'Clerk'],
    [/\bauth0\b/, ['auth0', '@auth0/nextjs-auth0'], 'Auth0'],
    [/\bnext-?auth\b|\bauth\.?js\b/, ['next-auth', '@auth/core', '@auth/nextjs'], 'Auth.js/NextAuth'],
    [/\bsupabase\b/, ['@supabase/supabase-js'], 'Supabase Auth'],
    [/\bfirebase\b/, ['firebase', 'firebase-admin'], 'Firebase Auth'],
    [/\blucia\b/, ['lucia'], 'Lucia'],
    [/\bbetter[- ]auth\b/, ['better-auth'], 'Better Auth'],
  ];
  for (const [regex, deps, label] of checks) {
    if (!regex.test(value)) continue;
    if (ctx.hasDependency(deps)) return;
    if (/\b(custom|jwt|session|password)\b/.test(value) && hasAuth) return;
    report(ctx, 'auth.model', `Fact says ${label}, but no matching auth dependency was found.`);
    return;
  }
  if (!hasAuth) report(ctx, 'auth.model', 'The facts require auth, but no auth dependency or server auth module exists.');
}

function checkPayments(ctx) {
  const value = valueOf(ctx, 'payments').toLowerCase();
  if (!value) return;
  const hasPayment = ctx.hasDependency(['stripe', '@stripe/stripe-js', '@paddle/paddle-node-sdk', '@lemon squeezy/lemonsqueezy.js', '@lemonsqueezy/lemonsqueezy.js']);
  if (/\bnone\b/.test(value)) {
    if (hasPayment) report(ctx, 'payments', 'Fact says no payments, but a payment SDK is installed.');
    return;
  }
  for (const [name, deps] of Object.entries(PAYMENT_DEPS)) {
    if (!value.includes(name)) continue;
    if (ctx.hasDependency(deps)) return;
    report(ctx, 'payments', `Fact says ${name}, but its SDK is not declared in package.json.`);
    return;
  }
}

function checkDeployment(ctx) {
  const value = valueOf(ctx, 'deployment').toLowerCase();
  if (!value || /\bnone\b|\blocal\b/.test(value)) return;
  for (const [name, markers] of Object.entries(DEPLOYMENT_MARKERS)) {
    if (!value.includes(name)) continue;
    // Config files may live at repo root or inside a nested app directory
    // (e.g. web/wrangler.toml); match at any depth.
    const found = ctx.files.some((file) => markers.some((marker) => {
      if (marker.includes('/')) return false;
      const escaped = marker.replace(/[.+]/g, '\\$&');
      return new RegExp(`(?:^|/)${escaped}$`).test(file.rel);
    }));
    if (found) return;
    ctx.report({
      ...locateFact(ctx, 'deployment'),
      severity: 'warn',
      message: `Fact says ${name}, but no deployment config was found (${markers.join(', ')}).`,
      data: { fact: 'deployment' },
    });
    return;
  }
}

function checkEntities(ctx) {
  const database = valueOf(ctx, 'stack.database').toLowerCase();
  if (/\bnone\b/.test(database)) return;
  const entry = fact(ctx, 'data.entities');
  if (!entry || !entry.value) return;

  // Schema evidence comes from migrations (.sql is a first-class schema
  // artifact) plus server code; build the real table/model name set.
  const schemaFiles = [...serverFiles(ctx), ...ctx.files.filter((file) => file.ext === '.sql')]
    .filter((file) => !file.isTest && !file.isFixture);
  const schemaText = [...new Set(schemaFiles)].map((file) => file.text).join('\n');
  const tables = new Set(collectTableNames(schemaText));

  const missing = [];
  for (const declaration of extractEntityDeclarations(String(entry.value))) {
    if (declaration.noTableRequired) continue;
    const present = declaration.names.some((name) => nameMatchesSchema(name, tables)) ||
      declaration.aliases.some((alias) => nameMatchesSchema(alias, tables));
    if (!present) missing.push(declaration.names.join('/'));
  }
  if (missing.length > 0) {
    ctx.report({
      ...locateFact(ctx, 'data.entities'),
      message: `Entities missing a model/schema: ${missing.join(', ')}. Tables found: ${[...tables].slice(0, 20).join(', ') || 'none'}.`,
      data: { fact: 'data.entities', entities: missing },
    });
  }
}

/** Every "Name (fields...)" style entity mention in the fact value, with
 *  per-sentence table aliases and no-table exemptions resolved. */
function extractEntityDeclarations(value) {
  const declarations = [];
  const sentences = value.split(/;\s*|(?:\.\s+|\band\b)\s*(?=[A-Z])/);
  for (const sentence of sentences) {
    const noTableRequired = /\bno\s+(?:cached\s+)?table\b|\bmaterialized on read\b/i.test(sentence);
    if (!/[A-Z][A-Za-z0-9_]*\s*(?:\/\s*[A-Z][A-Za-z0-9_]*\s*)?\(/.test(sentence) && !noTableRequired) continue;
    const names = [...sentence.matchAll(/\b([A-Z][A-Za-z0-9_]*)(?:\s*\/\s*([A-Z][A-Za-z0-9_]*))*\s*\(\s*\)?/g)];
    if (names.length === 0) continue;
    const list = names
      .flatMap((match) => [match[1], match[2]].filter(Boolean))
      .filter((name) => /^[A-Z][a-z]/.test(name) || /^[A-Z]+$/.test(name));
    if (list.length === 0) continue;
    const aliases = [...sentence.matchAll(/(?:stays|is|as)\s+the\s+([A-Za-z0-9_]+)\s+table\b/gi)].map((match) => match[1]);
    // "users.id is the Lead canonical id"-style canonicalization
    for (const match of sentence.matchAll(/\b([a-z0-9_]+)\.id\s+is\s+the\s+/gi)) aliases.push(match[1]);
    declarations.push({
      names: [...new Set(list)],
      aliases: [...new Set(aliases)],
      noTableRequired,
    });
  }
  return declarations;
}

/** CREATE TABLE names and common ORM model table identifiers from schema code. */
function collectTableNames(schemaText) {
  const names = [];
  for (const match of schemaText.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z0-9_]+)/gi)) {
    names.push(match[1]);
  }
  for (const match of schemaText.matchAll(/\b(?:pgTable|sqliteTable|mysqlTable|mongoTable|define|table)\s*\(\s*["'`]([A-Za-z0-9_]+)/gi)) {
    names.push(match[1]);
  }
  for (const match of schemaText.matchAll(/\bmongoose\.model\s*\(\s*["'`]([A-Za-z0-9_]+)/gi)) {
    names.push(match[1]);
  }
  return [...new Set(names)];
}

/** Entity names match tables at word-stem granularity: split camelCase and
 *  underscore names into words (JobRun vs job_runs, CommunicationLog vs
 *  communications), compare against the full name and every stem, with
 *  tolerant plurals. */
function nameMatchesSchema(name, tables) {
  const candidates = wordTokens(name);
  if (candidates.length === 0) return false;
  candidates.push(name.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  for (const table of tables) {
    const tableTokens = wordTokens(table);
    tableTokens.push(table.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    for (const candidate of candidates) {
      for (const token of tableTokens) {
        if (token === candidate) return true;
        if (singularize(token).includes(candidate) || singularize(candidate).includes(token)) return true;
      }
    }
  }
  return false;
}

/** camelCase / snake_case words of an identifier, lowercased. */
function nameStems(identifier) {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function wordTokens(identifier) {
  return nameStems(identifier).filter((word) => word.length > 2);
}

const SINGULAR_RULES = [
  (word) => (word.endsWith('ies') ? `${word.slice(0, -3)}y` : null),
  (word) => (word.endsWith('sses') ? word.slice(0, -2) : null),
  (word) => (word.endsWith('hes') || word.endsWith('ches') || word.endsWith('shes') ? word.slice(0, -2) : null),
  (word) => (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') ? word.slice(0, -1) : null),
  (word) => (word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : null),
];

function singularize(word) {
  const variants = [word];
  for (const rule of SINGULAR_RULES) {
    const variant = rule(word);
    if (variant) variants.push(variant);
  }
  return variants;
}

function locateFact(ctx, id) {
  const file = ctx.files.find((entry) => entry.rel === ctx.factsFile);
  if (!file) return { file: ctx.factsFile, line: 1 };
  const index = file.text.indexOf(`"${id}"`);
  if (index === -1) return { file, line: 1 };
  return { file, index };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
