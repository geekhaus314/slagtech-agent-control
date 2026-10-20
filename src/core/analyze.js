import path from 'node:path';

const FRONTEND_PRIORITY = [
  ['next', 'next'], ['nuxt', 'nuxt'], ['@sveltejs/kit', 'sveltekit'], ['svelte', 'svelte'],
  ['astro', 'astro'], ['@remix-run/react', 'remix'], ['solid-js', 'solid'], ['@angular/core', 'angular'],
  ['vue', 'vue'], ['react', 'react'],
];

const BACKEND_PRIORITY = [
  ['next', 'next'], ['nuxt', 'nuxt'], ['@sveltejs/kit', 'sveltekit'], ['astro', 'astro'],
  ['@remix-run/react', 'remix'], ['hono', 'hono'], ['fastify', 'fastify'], ['express', 'express'],
  ['koa', 'koa'], ['@nestjs/core', 'nestjs'],
];

const ORM_PRIORITY = [
  ['prisma', '@prisma/client'], ['drizzle-orm', 'drizzle'], ['sequelize', 'sequelize'],
  ['typeorm', 'typeorm'], ['mongoose', 'mongoose'], ['knex', 'knex'], ['better-sqlite3', 'sqlite'],
  ['@supabase/supabase-js', 'supabase'], ['firebase', 'firebase'], ['@planetscale/database', 'planetscale'],
  ['@neondatabase/serverless', 'neon'], ['pg', 'postgres'], ['mysql2', 'mysql'], ['mongodb', 'mongodb'],
];

const AUTH_PRIORITY = [
  ['next-auth', 'next-auth'], ['@auth/core', 'authjs'], ['better-auth', 'better-auth'],
  ['@clerk/nextjs', 'clerk'], ['@clerk/clerk-react', 'clerk'], ['@supabase/supabase-js', 'supabase'],
  ['lucia', 'lucia'], ['@lucia-auth/adapter-prisma', 'lucia'], ['passport', 'passport'],
  ['firebase', 'firebase'],
];

const DATA_ACCESS = /(\bprisma\b|\bdrizzle\b|\bknex\b|\bsequelize\b|\btypeorm\b|\bmongoose\b|\bmongodb\b|\bpostgres\b|\bpg\b|\bmysql2?\b|\bsqlite3?\b|\bbetter-sqlite3\b|\blibsql\b|\bturso\b|\bneon\b|\bplanetscale\b|\bsupabase\b|\bfirestore\b|\bfirebase\b|\bredis\b|\bupstash\b|\bkv\b|\bsql`|\bdb\.[a-zA-Z]|\bD1Database\b|\bprisma\.[a-zA-Z])/;
const MUTATION_METHODS = /\.(findMany|findUnique|findFirst|create|createMany|update|updateMany|upsert|delete|deleteMany|insert|select|execute|query)\s*\(/;
const SIDE_EFFECTS = /(\bfetch\s*\(|\baxios\b|\bstripe\b|\bresend\b|\bnodemailer\b|\bsendgrid\b|\bpostmark\b|\btwilio\b|\bsendEmail\b|\bsendMail\b|\bS3\b|\bR2\b|\bputObject\b|\bupload\b|\bfs\.(write|append|mkdir|rm)\b|\bcookies\(\)\.set\b|\bqueue\b|\bpubsub\b|\benqueue\b|\bD1Database\b|\bKVNamespace\b)/i;
const AUTH_CHECK = /(\bauth\s*\(|\bgetServerSession\b|\bgetSession\b|\bcurrentUser\b|\brequireUser\b|\brequireAuth\b|\bverifyToken\b|\bverifyJwt\b|\bjwtVerify\b|\bgetAuth\b|\bclerk\b|\bsupabase\.auth\.getUser\b|\bsession\.user\b|\bvalidateSession\b|\bcreateSession\b|\bpassport\b|\bbcrypt\.compare\b|\bwithAuth\b|\bassertAuth\b|\bcheckAuth\b)/i;
const VALIDATION = /(\bzod\b|\byup\b|\bvalibot\b|\bjoi\b|\bsuperstruct\b|\bajv\b|\bclass-validator\b|\bsafeParse\b|\.parse\s*\(|\bvalidate[A-Z(]|\bSchema\b|\bschema\.|typeof\s+[A-Za-z_$][\w$]*\s*===|Array\.isArray\s*\()/;

export function analyzeProject({ files, packageJson, config }) {
  const deps = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) };
  const scripts = packageJson?.scripts ?? {};
  const framework = detectFramework(deps);
  const routes = discoverRoutes(files);
  const apiRoutes = discoverApiRoutes(files);
  const publicAssets = new Set(
    files
      .filter((file) => file.rel.startsWith('public/') || file.rel.startsWith('static/'))
      .map((file) => `/${file.rel.split('/').slice(1).join('/')}`),
  );
  const testFiles = files.filter((file) => file.isTest);
  const sourceFiles = files.filter((file) => file.isSource);
  const styleFiles = files.filter((file) => file.isStyle);
  const codeFiles = files.filter((file) => file.isCode);

  return {
    framework,
    deps,
    scripts,
    routes,
    routeMatchers: routes.map(routeMatcherFor),
    apiRoutes,
    apiMatchers: apiRoutes.map(routeMatcherFor),
    publicAssets,
    testFiles,
    sourceFiles,
    styleFiles,
    codeFiles,
    hasDependency: (names) => names.some((name) => Boolean(deps[name])),
    config,
  };
}

function detectFramework(deps) {
  const pick = (list) => {
    for (const [dep, name] of list) {
      if (deps[dep]) return name;
    }
    return null;
  };
  const frontend = pick(FRONTEND_PRIORITY);
  const backend = pick(BACKEND_PRIORITY);
  const orm = pick(ORM_PRIORITY);
  const auth = pick(AUTH_PRIORITY);
  const database = ['pg', '@neondatabase/serverless', 'postgres', 'mysql2', 'mysql', 'better-sqlite3', 'mongodb', 'mongoose', '@planetscale/database']
    .find((dep) => deps[dep]) ?? null;
  return { frontend, backend, orm, auth, database };
}

function stripExt(rel) {
  return rel.replace(/\.[^./]+$/, '');
}

function appRootOf(rel) {
  const match = rel.match(/^(?:src\/)?app\//);
  return match ? match[0] : null;
}

function normalizeRoute(segments) {
  const cleaned = segments
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .filter((segment) => !segment.startsWith('@'))
    .filter((segment) => segment !== 'index');
  return `/${cleaned.join('/')}`.replace(/\/$/, '') || '/';
}

export function discoverRoutes(files) {
  const routes = [];
  for (const file of files) {
    const rel = file.rel;
    const base = file.base;

    if (/(^|\/)page\.(js|jsx|ts|tsx|md|mdx)$/.test(rel) && rel.match(/^(?:src\/)?app\//)) {
      const appRoot = appRootOf(rel);
      const rest = rel.slice(appRoot.length).split('/');
      rest.pop();
      routes.push({ path: normalizeRoute(rest), file: rel, kind: 'next-app' });
      continue;
    }

    if (/(^|\/)pages\//.test(rel) && /\.(js|jsx|ts|tsx|md|mdx)$/.test(rel) && !/\/pages\/api\//.test(rel)) {
      const index = rel.indexOf('pages/');
      const rest = rel.slice(index + 'pages/'.length);
      if (/^_(app|document|error|404)/.test(rest)) continue;
      const segments = stripExt(rest).split('/');
      routes.push({ path: normalizeRoute(segments), file: rel, kind: 'next-pages' });
      continue;
    }

    if (/(^|\/)src\/pages\//.test(rel) && /\.(astro|md|mdx)$/.test(rel)) {
      const rest = rel.split('src/pages/')[1];
      const segments = stripExt(rest).split('/');
      routes.push({ path: normalizeRoute(segments), file: rel, kind: 'astro' });
      continue;
    }

    if (/(^|\/)src\/routes\/.*\/\+page\.(svelte|js|ts)$/.test(rel)) {
      const rest = rel.split('src/routes/')[1].replace(/\/?\+page\.[^.]+$/, '');
      routes.push({ path: normalizeRoute(rest.split('/')), file: rel, kind: 'sveltekit' });
      continue;
    }

    if (/(^|\/)pages\/.*\.vue$/.test(rel) && !/(^|\/)node_modules\//.test(rel)) {
      const rest = rel.split('pages/')[1];
      routes.push({ path: normalizeRoute(stripExt(rest).split('/')), file: rel, kind: 'nuxt' });
      continue;
    }

    if (/(^|\/)app\/routes\//.test(rel) && /\.(js|jsx|ts|tsx)$/.test(rel)) {
      const rest = rel.split('app/routes/')[1];
      const name = stripExt(rest).replace(/_index$/, '').replace(/\$/g, ':').replace(/\./g, '/');
      routes.push({ path: normalizeRoute(name.split('/')), file: rel, kind: 'remix' });
      continue;
    }

    if (base === 'index.html') {
      routes.push({ path: '/', file: rel, kind: 'html' });
      continue;
    }
    if (file.ext === '.html' && !/(^|\/)(node_modules|public|static|dist|build)\//.test(rel)) {
      routes.push({ path: normalizeRoute(stripExt(rel).split('/')), file: rel, kind: 'html' });
    }
  }
  return dedupeRoutes(routes);
}

export function discoverApiRoutes(files) {
  const routes = [];
  for (const file of files) {
    const rel = file.rel;

    if (/(^|\/)route\.(js|jsx|ts|tsx)$/.test(rel) && rel.match(/^(?:src\/)?app\//)) {
      const appRoot = appRootOf(rel);
      const rest = rel.slice(appRoot.length).split('/');
      rest.pop();
      const methods = extractMethods(file.text);
      routes.push({ path: normalizeRoute(rest), file: rel, kind: 'next-route', methods });
      continue;
    }

    if (/(^|\/)pages\/api\/.*\.(js|jsx|ts|tsx)$/.test(rel)) {
      const rest = rel.split(/pages\/api\//)[1];
      routes.push({ path: normalizeRoute(['api', ...stripExt(rest).split('/')]), file: rel, kind: 'next-pages-api', methods: extractMethods(file.text) });
      continue;
    }

    if (/(^|\/)src\/pages\/api\/.*\.(js|jsx|ts|tsx)$/.test(rel)) {
      const rest = rel.split(/src\/pages\/api\//)[1];
      routes.push({ path: normalizeRoute(['api', ...stripExt(rest).split('/')]), file: rel, kind: 'astro-api', methods: extractMethods(file.text) });
      continue;
    }

    if (/\/\+server\.(js|ts)$/.test(rel) && /(^|\/)src\/routes\//.test(rel)) {
      const rest = rel.split('src/routes/')[1].replace(/\/?\+server\.[^.]+$/, '');
      routes.push({ path: normalizeRoute(rest.split('/')), file: rel, kind: 'sveltekit-api', methods: extractMethods(file.text) });
      continue;
    }

    if (/(^|\/)server\/api\/.*\.(js|ts|mjs)$/.test(rel)) {
      const rest = rel.split(/server\/api\//)[1];
      routes.push({ path: normalizeRoute(['api', ...stripExt(rest).split('/')]), file: rel, kind: 'nuxt-api', methods: extractMethods(file.text) });
      continue;
    }

    if (!file.isCode || file.isTest) continue;
    if (!/(^|\/)(server|src\/server|api|src\/api|routes|functions|workers)\//.test(rel)) continue;

    const literalRoutes = extractFrameworkRoutes(file.text);
    for (const literal of literalRoutes) {
      routes.push({ path: literal.path, file: rel, kind: 'framework', methods: literal.methods });
    }
  }
  return dedupeRoutes(routes);
}

function extractMethods(text) {
  const methods = new Set();
  for (const match of text.matchAll(/\bexport\s+(?:async\s+)?(?:function\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
    methods.add(match[1]);
  }
  for (const match of text.matchAll(/\b(?:app|router|server)\.(get|post|put|patch|delete)\s*\(/gi)) {
    methods.add(match[1].toUpperCase());
  }
  return [...methods];
}

function extractFrameworkRoutes(text) {
  const routes = [];
  const byPath = new Map();
  const re = /\b(?:app|router|server|api)\.(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2/gi;
  for (const match of text.matchAll(re)) {
    const routePath = match[3];
    if (!routePath.startsWith('/')) continue;
    const entry = byPath.get(routePath) ?? { path: routePath.replace(/\/$/, '') || '/', methods: [] };
    entry.methods.push(match[1].toUpperCase() === 'ALL' ? 'ALL' : match[1].toUpperCase());
    byPath.set(routePath, entry);
  }
  routes.push(...byPath.values());
  return routes;
}

function dedupeRoutes(routes) {
  const seen = new Map();
  for (const route of routes) {
    const key = `${route.path}|${route.file}|${route.kind}`;
    if (!seen.has(key)) seen.set(key, route);
  }
  return [...seen.values()];
}

export function routeToRegExp(routePath) {
  const segments = routePath.split('/').map((segment) => {
    if (/^\[\[?\.\.\.[^\]]+\]\]?$/.test(segment)) return '.*';
    if (/^\[[^\]]+\]$/.test(segment)) return '[^/]+';
    if (/^:[\w]+$/.test(segment)) return '[^/]+';
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(`^${segments.join('/')}/?$`);
}

function routeMatcherFor(route) {
  return { ...route, regex: routeToRegExp(route.path) };
}

export function matchRoute(candidate, matchers) {
  const clean = candidate.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';
  return matchers.find((matcher) => matcher.regex.test(clean)) ?? null;
}

export function hasDataAccess(text) {
  return DATA_ACCESS.test(text) || MUTATION_METHODS.test(text);
}

export function hasSideEffect(text) {
  return hasDataAccess(text) || SIDE_EFFECTS.test(text);
}

export function hasAuthCheck(text) {
  return AUTH_CHECK.test(text);
}

export function hasValidation(text) {
  return VALIDATION.test(text);
}

export function isServerFile(file) {
  const rel = file.rel.toLowerCase();
  return file.isServerDirective || file.isApiPath ||
    /(^|\/)(server|backend|lib\/server|src\/server)\//.test(rel) ||
    /(^|\/)(route|server|actions?|handler)\.(js|jsx|ts|tsx)$/.test(rel);
}

export function packageManagerFor(rootFiles, pkg) {
  const names = new Set(rootFiles.map((file) => file.base));
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('yarn.lock')) return 'yarn';
  if (names.has('bun.lockb') || names.has('bun.lock')) return 'bun';
  if (names.has('package-lock.json')) return 'npm';
  return pkg?.packageManager?.split('@')[0] ?? 'npm';
}

export function relativeFromRoot(root, abs) {
  return path.relative(root, abs).replaceAll('\\', '/');
}
