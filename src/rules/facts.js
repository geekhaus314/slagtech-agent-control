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
    [/\bcloudflare\b/, ['wrangler', '@cloudflare/workers-types'], 'Cloudflare Workers'],
    [/\bsupabase\b/, ['@supabase/supabase-js'], 'Supabase'],
    [/\bfirebase\b/, ['firebase', 'firebase-admin'], 'Firebase'],
  ];
  for (const [regex, deps, label] of checks) {
    if (!regex.test(value)) continue;
    const configMarker = label === 'Cloudflare Workers' && ctx.files.some((file) => /^wrangler\.(toml|jsonc?|json)$/.test(file.rel));
    if (ctx.hasDependency(deps) || configMarker) return;
    report(ctx, 'stack.backend', `Fact says ${label}, but no matching dependency or config was found.`);
    return;
  }
}

function checkDatabase(ctx) {
  const value = valueOf(ctx, 'stack.database').toLowerCase();
  if (!value) return;
  const hasDb = ctx.hasDependency(DB_DEPS);
  if (/\bnone\b/.test(value)) {
    if (hasDb) report(ctx, 'stack.database', 'Fact says no database, but database/ORM dependencies are installed.');
    return;
  }
  const checks = [
    [/\bprisma\b/, ['prisma', '@prisma/client'], 'Prisma'],
    [/\bdrizzle\b/, ['drizzle-orm'], 'Drizzle'],
    [/\bpostgres/, ['pg', 'postgres', '@neondatabase/serverless', '@vercel/postgres', 'prisma', '@prisma/client', 'drizzle-orm', '@supabase/supabase-js', '@planetscale/database'], 'PostgreSQL'],
    [/\bmysql\b/, ['mysql2', 'mysql', 'prisma', '@prisma/client', 'drizzle-orm'], 'MySQL'],
    [/\bsqlite\b/, ['better-sqlite3', 'sqlite3', 'libsql', '@libsql/client', 'prisma', '@prisma/client', 'drizzle-orm'], 'SQLite'],
    [/\bmongo(db)?\b/, ['mongodb', 'mongoose', 'prisma', '@prisma/client'], 'MongoDB'],
    [/\bsupabase\b/, ['@supabase/supabase-js'], 'Supabase'],
    [/\bfire(base|store)\b/, ['firebase', 'firebase-admin'], 'Firestore'],
    [/\bredis\b/, ['redis', 'ioredis', '@upstash/redis'], 'Redis'],
  ];
  for (const [regex, deps, label] of checks) {
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
    if (ctx.files.some((file) => markers.includes(file.rel))) return;
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
  const entities = extractEntityNames(entry.value);
  if (entities.length === 0) return;
  const schemaText = serverFiles(ctx)
    .filter((file) => !file.isTest && !file.isFixture)
    .map((file) => file.text)
    .join('\n');
  if (!hasSchemaMarkers(schemaText)) {
    ctx.report({
      ...locateFact(ctx, 'data.entities'),
      message: `Facts list entities (${entities.join(', ')}) but no schema/model definitions were found.`,
      data: { fact: 'data.entities', entities },
    });
    return;
  }
  const missing = entities.filter((entity) => !mentionsEntity(schemaText, entity));
  if (missing.length > 0) {
    ctx.report({
      ...locateFact(ctx, 'data.entities'),
      message: `Entities missing a model/schema: ${missing.join(', ')}.`,
      data: { fact: 'data.entities', entities: missing },
    });
  }
}

function extractEntityNames(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
      .filter(Boolean)
      .map((name) => String(name).replace(/[^A-Za-z0-9_]/g, ''))
      .filter(Boolean)
      .slice(0, 20);
  }
  return String(value)
    .split(/[,;]|\band\b/)
    .map((part) => part.trim().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ''))
    .filter((part) => /^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(part))
    .slice(0, 20);
}

function hasSchemaMarkers(text) {
  return /\bmodel\s+[A-Z]\w*\s*\{|\bCREATE TABLE\b|\b(pgTable|sqliteTable|mysqlTable|mongoTable)\s*\(|\bmongoose\.model\s*\(|\bsequelize\.define\s*\(|@Entity\b|\bclass\s+\w+\s*\(\s*models\.Model\s*\)|supabase\.from\s*\(|\bdb\.collection\s*\(/i.test(text);
}

function mentionsEntity(text, entity) {
  const lower = entity.toLowerCase();
  const plural = lower.endsWith('s') ? lower : `${lower}s`;
  const name = escapeRegExp(entity);
  const patterns = [
    new RegExp(`\\bmodel\\s+${name}\\b`),
    new RegExp(`\\bCREATE TABLE\\s+(IF NOT EXISTS\\s+)?["'\`]?(${lower}|${plural})\\b`, 'i'),
    new RegExp(`\\b(pgTable|sqliteTable|mysqlTable|table|define)\\s*\\(\\s*["'\`](${lower}|${plural})["'\`]`, 'i'),
    new RegExp(`\\bmongoose\\.model\\s*\\(\\s*["'\`]${name}\\b`),
    new RegExp(`\\bclass\\s+${name}\\s*\\(\\s*models\\.Model\\s*\\)`),
    new RegExp(`\\bsupabase\\.from\\s*\\(\\s*["'\`](${lower}|${plural})["'\`]`, 'i'),
    new RegExp(`\\bdb\\.collection\\s*\\(\\s*["'\`](${lower}|${plural})["'\`]`, 'i'),
    new RegExp(`\\b@Entity\\([^)]*\\)[\\s\\S]{0,120}?class\\s+${name}\\b`),
  ];
  return patterns.some((pattern) => pattern.test(text));
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
