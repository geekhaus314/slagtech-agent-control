import fs from 'node:fs/promises';
import path from 'node:path';
import { stripJsonComments } from './config.js';

export const FACTS_VERSION = 1;

export const FACT_TEMPLATE = [
  {
    id: 'delivery.mode',
    question: 'Is this production software or a prototype/mockup? What quality bar applies? Answer "production" or "prototype".',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: [],
    notes: 'Production means mock data, placeholders, dead controls and unconfirmed facts fail the gate. Prototype relaxes presentation rules but never security.',
  },
  {
    id: 'scope.core',
    question: 'List the core user actions that must work end-to-end. Each one needs a real path through UI, server and storage.',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: [],
    notes: 'Example: "user signs up, creates a project, invites a teammate, and sees it after reload".',
  },
  {
    id: 'scope.out',
    question: 'What is explicitly out of scope for this build?',
    value: null,
    status: 'unknown',
    source: null,
    required: false,
    evidence: [],
    notes: 'Out-of-scope items must not appear in the README as implemented features.',
  },
  {
    id: 'stack.frontend',
    question: 'Which frontend framework, version, router, styling system and component library?',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: [],
    notes: 'Do not assume a stack from the template. Confirm the exact packages and versions.',
  },
  {
    id: 'stack.backend',
    question: 'Which backend/API runtime and hosting model? Use "none" only for a genuinely static site.',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: [],
    notes: 'Confirm where server code runs before creating API routes or server actions.',
  },
  {
    id: 'stack.database',
    question: 'Which database, ORM/query layer and migration strategy? Use "none" if nothing must persist.',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: [],
    notes: 'A database dependency without a schema or migrations is an unfinished data layer.',
  },
  {
    id: 'data.entities',
    question: 'List the entities, their fields, relationships, and who may access each one.',
    value: null,
    status: 'unknown',
    source: null,
    required: false,
    evidence: [],
    notes: 'Each entity must have a real schema/model, not only a TypeScript interface.',
  },
  {
    id: 'auth.model',
    question: 'Who signs in, how are sessions verified server-side, and what roles exist? Use "none" for a public app.',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: [],
    notes: 'Client-side user flags, localStorage tokens and literal password checks are not auth.',
  },
  {
    id: 'payments',
    question: 'Which payment or billing provider is required? Use "none" if not needed.',
    value: null,
    status: 'unknown',
    source: null,
    required: false,
    evidence: [],
    notes: 'Name the provider and the flow (checkout, subscription, webhook).',
  },
  {
    id: 'integrations',
    question: 'Which third-party services are required, and which credentials do they need? Use "none" if none.',
    value: null,
    status: 'unknown',
    source: null,
    required: false,
    evidence: [],
    notes: 'List only integrations that must actually work in this build.',
  },
  {
    id: 'deployment',
    question: 'What is the deployment target, and which environments must work (local, preview, production)?',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: [],
    notes: 'The build must be runnable on the stated target, not only on the agent machine.',
  },
  {
    id: 'quality.acceptance',
    question: 'What is the definition of done per core action, including tests, error/empty/loading states, and accessibility?',
    value: null,
    status: 'unknown',
    source: null,
    required: true,
    evidence: ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/e2e/**', '**/__tests__/**'],
    notes: 'If there are no tests, this fact cannot be proven.',
  },
  {
    id: 'data.seed',
    question: 'Should demo/seed data exist? If yes, should it ever appear in production? How is real data loaded?',
    value: null,
    status: 'unknown',
    source: null,
    required: false,
    evidence: [],
    notes: 'Saying yes to seed data does not make mock data a production data source.',
  },
  {
    id: 'design.direction',
    question: 'What brand, references, real copy and real assets should be used? Or has the user explicitly delegated visual direction?',
    value: null,
    status: 'unknown',
    source: null,
    required: false,
    evidence: [],
    notes: 'Delegated design still needs real content and functional behavior.',
  },
  {
    id: 'nonfunctional',
    question: 'Expected scale, latency, accessibility, compliance and browser support requirements?',
    value: null,
    status: 'unknown',
    source: null,
    required: false,
    evidence: [],
    notes: 'Only list constraints that change implementation decisions.',
  },
];

const STACK_INFERENCE = [
  { id: 'stack.frontend', patterns: [
    [/\bnext(?:\.js)?\b/i, 'Next.js'], [/\bnuxt\b/i, 'Nuxt'], [/\bsveltekit\b/i, 'SvelteKit'],
    [/\bsvelte\b/i, 'Svelte'], [/\bastro\b/i, 'Astro'], [/\bremix\b/i, 'Remix'], [/\bangular\b/i, 'Angular'],
    [/\bvue\b/i, 'Vue'], [/\breact\b/i, 'React'], [/\bhtml\/css\b/i, 'HTML/CSS'],
  ] },
  { id: 'stack.backend', patterns: [
    [/\bnext(?:\.js)?\b/i, 'Next.js server/route handlers'], [/\bexpress\b/i, 'Express'], [/\bfastify\b/i, 'Fastify'],
    [/\bhono\b/i, 'Hono'], [/\bcloudflare workers?\b/i, 'Cloudflare Workers'], [/\bsupabase\b/i, 'Supabase'],
    [/\bfirebase\b/i, 'Firebase'], [/\bstatic (site|website)\b/i, 'none (static site)'],
  ] },
  { id: 'stack.database', patterns: [
    [/\bpostgres(?:ql)?\b/i, 'PostgreSQL'], [/\bmysql\b/i, 'MySQL'], [/\bsqlite\b/i, 'SQLite'],
    [/\bmongodb\b/i, 'MongoDB'], [/\bsupabase\b/i, 'Supabase Postgres'], [/\bfirebase\b/i, 'Firestore'],
    [/\bprisma\b/i, 'Prisma'], [/\bdrizzle\b/i, 'Drizzle'], [/\bredis\b/i, 'Redis'],
  ] },
  { id: 'auth.model', patterns: [
    [/\bclerk\b/i, 'Clerk'], [/\bauth0\b/i, 'Auth0'], [/\bnextauth\b|next-auth/i, 'Auth.js/NextAuth'],
    [/\bsupabase auth\b/i, 'Supabase Auth'], [/\bfirebase auth\b/i, 'Firebase Auth'],
    [/\bno auth\b|\bwithout auth\b|\bpublic app\b/i, 'none'],
  ] },
  { id: 'payments', patterns: [
    [/\bstripe\b/i, 'Stripe'], [/\bpaddle\b/i, 'Paddle'], [/\blemon ?squeezy\b/i, 'Lemon Squeezy'],
  ] },
  { id: 'deployment', patterns: [
    [/\bvercel\b/i, 'Vercel'], [/\bnetlify\b/i, 'Netlify'], [/\bcloudflare\b/i, 'Cloudflare'],
    [/\bfly\.io\b|\bfly\b/i, 'Fly.io'], [/\brailway\b/i, 'Railway'], [/\brender\b/i, 'Render'],
    [/\baws\b/i, 'AWS'], [/\bdocker\b/i, 'Docker'], [/\bself[- ]hosted\b/i, 'self-hosted'],
  ] },
  { id: 'integrations', patterns: [
    [/\bopenai\b/i, 'OpenAI'], [/\banthropic\b|\bclaude\b/i, 'Anthropic'], [/\bresend\b/i, 'Resend'],
    [/\bsendgrid\b/i, 'SendGrid'], [/\bcloudinary\b/i, 'Cloudinary'], [/\btwilio\b/i, 'Twilio'],
    [/\bs3\b/i, 'S3'], [/\br2\b/i, 'Cloudflare R2'],
  ] },
];

export async function loadFacts(root, config = {}) {
  if (config.factsFile === null || config.factsFile === false) {
    return { facts: [], missing: false, enabled: false, file: null, abs: null, warnings: [] };
  }
  const factsFile = config.factsFile ?? 'slag.facts.json';
  const abs = path.isAbsolute(factsFile) ? factsFile : path.join(root, factsFile);
  const warnings = [];
  let raw;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch {
    return { facts: buildDefaultFacts(), missing: true, enabled: true, file: factsFile, abs, warnings };
  }
  try {
    const parsed = JSON.parse(stripJsonComments(raw));
    const facts = normalizeFacts(parsed.facts ?? parsed);
    if (facts.length === 0) {
      warnings.push(`${factsFile} contains no facts.`);
    }
    return { facts, missing: false, enabled: true, file: factsFile, abs, warnings };
  } catch (error) {
    warnings.push(`Could not parse ${factsFile}: ${error.message}`);
    return { facts: buildDefaultFacts(), missing: true, enabled: true, file: factsFile, abs, warnings };
  }
}

export function normalizeFacts(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input
    .filter((fact) => fact && typeof fact === 'object' && typeof fact.id === 'string')
    .filter((fact) => {
      if (seen.has(fact.id)) return false;
      seen.add(fact.id);
      return true;
    })
    .map((fact) => ({
      id: fact.id,
      question: fact.question ?? fact.label ?? fact.id,
      value: fact.value ?? null,
      status: ['unknown', 'assumed', 'confirmed'].includes(fact.status) ? fact.status : 'unknown',
      source: fact.source ?? null,
      required: fact.required !== false,
      evidence: Array.isArray(fact.evidence) ? fact.evidence : [],
      notes: fact.notes ?? null,
    }));
}

export function buildDefaultFacts() {
  return FACT_TEMPLATE.map((fact) => ({ ...fact, evidence: [...fact.evidence] }));
}

export function inferFactsFromPrompt(prompt = '') {
  const facts = buildDefaultFacts();
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const matched = [];

  for (const group of STACK_INFERENCE) {
    for (const [regex, value] of group.patterns) {
      const match = prompt.match(regex);
      if (!match || isNegated(prompt, match.index ?? 0)) continue;
      const fact = byId.get(group.id);
      if (!fact || fact.value) continue;
      fact.value = value;
      fact.status = 'assumed';
      fact.source = 'initial prompt (inferred; confirm details with the user)';
      matched.push(group.id);
      break;
    }
  }

  const modeMatch = prompt.match(/\b(production[- ]ready|production|prototype|mockup|mock-up|demo|proof of concept|poc)\b/i);
  if (modeMatch && !isNegated(prompt, modeMatch.index ?? 0)) {
    const modeFact = byId.get('delivery.mode');
    modeFact.value = /prototype|mockup|mock-up|demo|proof of concept|poc/i.test(modeMatch[0]) ? 'prototype' : 'production';
    modeFact.status = 'confirmed';
    modeFact.source = 'initial prompt';
    modeFact.notes = 'Explicitly stated in the initial request.';
    matched.push('delivery.mode');
  }

  if (/\b(no auth|without auth|public (app|site)|no login)\b/i.test(prompt)) {
    const fact = byId.get('auth.model');
    fact.value = 'none';
    fact.status = 'confirmed';
    fact.source = 'initial prompt';
  }
  if (/\b(no database|static site|no backend|no persistence)\b/i.test(prompt)) {
    if (!byId.get('stack.database').value) {
      byId.get('stack.database').value = 'none';
      byId.get('stack.database').status = 'confirmed';
      byId.get('stack.database').source = 'initial prompt';
    }
  }

  return { facts, matched: [...new Set(matched)] };
}

export function deliveryModeFromFacts(facts = [], override = null) {
  if (override === 'production' || override === 'prototype') return override;
  const fact = facts.find((entry) => entry.id === 'delivery.mode');
  if (!fact) return null;
  if (!['confirmed', 'assumed'].includes(fact.status)) return null;
  const value = String(fact.value ?? '').toLowerCase();
  if (/\b(production|prod|live|real|shippable)\b/.test(value)) return 'production';
  if (/\b(prototype|mockup|mock-up|demo|poc|proof of concept|scaffold)\b/.test(value)) return 'prototype';
  return null;
}

export function factSummary(facts = []) {
  const required = facts.filter((fact) => fact.required);
  return {
    total: facts.length,
    confirmed: facts.filter((fact) => fact.status === 'confirmed').length,
    assumed: facts.filter((fact) => fact.status === 'assumed').length,
    unknown: facts.filter((fact) => fact.status === 'unknown').length,
    requiredTotal: required.length,
    requiredConfirmed: required.filter((fact) => fact.status === 'confirmed').length,
    requiredUnconfirmed: required.filter((fact) => fact.status !== 'confirmed').map((fact) => fact.id),
  };
}

export function factsHashValue(facts) {
  return JSON.stringify(facts.map((fact) => ({
    id: fact.id,
    value: fact.value,
    status: fact.status,
    source: fact.source,
    evidence: fact.evidence,
    required: fact.required,
  })));
}

export function questionsFor(facts, { includeOptional = true } = {}) {
  return facts
    .filter((fact) => fact.status !== 'confirmed' && (includeOptional || fact.required))
    .map((fact) => ({
      id: fact.id,
      question: fact.question,
      status: fact.status,
      currentValue: fact.value,
      required: fact.required,
    }));
}

function isNegated(text, index) {
  const before = text.slice(Math.max(0, index - 24), index);
  return /\b(no|not|without|avoid|don't|doesn't|isn't)\s+$/i.test(before);
}
