const CLAIMS = [
  {
    id: 'auth',
    label: 'authentication',
    regex: /\b(authentication|sign[- ]?in|log[- ]?in|sign[- ]?up|oauth|sso|session management|user accounts?)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['next-auth', '@auth/core', 'better-auth', 'lucia', '@clerk/nextjs', '@clerk/clerk-react', 'auth0', '@auth0/nextjs-auth0', 'passport', 'firebase', 'firebase-admin', '@supabase/supabase-js']) ||
      ctx.files.some((file) => /(^|\/)(auth|session|middleware)\.(js|jsx|ts|tsx)$/.test(file.rel)) ||
      ctx.files.some((file) => /(getServerSession|requireAuth|requireUser|verifyToken|supabase\.auth\.getUser)/.test(file.text) && !file.isTest),
    why: 'no auth dependency, auth module or server-side session check exists',
  },
  {
    id: 'payments',
    label: 'payments',
    regex: /\b(stripe|payments?|checkout|billing|subscriptions?|invoices?)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['stripe', '@stripe/stripe-js', '@paddle/paddle-node-sdk', '@lemonsqueezy/lemonsqueezy.js', 'braintree']),
    why: 'no payment SDK is declared',
  },
  {
    id: 'database',
    label: 'database',
    regex: /\b(database|postgres(?:ql)?|mysql|sqlite|mongodb|persistence|persistent storage|data layer)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['prisma', '@prisma/client', 'drizzle-orm', 'knex', 'sequelize', 'typeorm', 'mongoose', 'mongodb', 'pg', 'postgres', '@neondatabase/serverless', 'mysql2', 'better-sqlite3', '@supabase/supabase-js', 'firebase', 'redis', '@upstash/redis']) ||
      ctx.files.some((file) => /(^|\/)(schema\.prisma|migrations?\/)/.test(file.rel)),
    why: 'no database driver, ORM, schema or migration exists',
  },
  {
    id: 'realtime',
    label: 'real-time behavior',
    regex: /\b(real[- ]?time|websockets?|live updates?|server[- ]sent events?|sse)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['socket.io', 'socket.io-client', 'ws', 'pusher', 'pusher-js', '@ably/ably', 'ably', 'partysocket']) ||
      ctx.files.some((file) => /(EventSource|WebSocket|supabase\.channel|io\s*\()/.test(file.text) && !file.isTest && !file.isDoc),
    why: 'no WebSocket/SSE/Realtime client or server code exists',
  },
  {
    id: 'ai',
    label: 'AI features',
    regex: /\b(ai[- ]powered|artificial intelligence|llm|gpt|openai|anthropic|machine learning)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['openai', '@anthropic-ai/sdk', 'ai', '@google/generative-ai', 'langchain', '@langchain/core']) ||
      ctx.files.some((file) => /(openai|anthropic|generateText|streamText|chat\.completions|messages\.create)/.test(file.text) && !file.isTest && !file.isDoc),
    why: 'no model SDK or model call exists',
  },
  {
    id: 'email',
    label: 'email delivery',
    regex: /\b(transactional email|email notifications?|sendgrid|mailgun|postmark|smtp|resend)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['resend', '@sendgrid/mail', 'nodemailer', 'mailgun.js', 'postmark']),
    why: 'no email SDK is declared',
  },
  {
    id: 'uploads',
    label: 'file uploads',
    regex: /\b(file uploads?|image uploads?|object storage|s3|cloudflare r2|blob storage)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['@aws-sdk/client-s3', 'aws-sdk', '@cloudflare/workers-types', 'cloudinary', '@vercel/blob', 'multer', 'busboy', 'formidable']) ||
      ctx.files.some((file) => /(putObject|uploadFile|s3\.upload|formData\(\))/.test(file.text) && !file.isTest && !file.isDoc),
    why: 'no storage SDK or upload handler exists',
  },
  {
    id: 'tests',
    label: 'test coverage',
    regex: /\b(tested|test suite|unit tests?|e2e tests?|integration tests?|coverage)\b/gi,
    evidence: (ctx) => ctx.testFiles.length > 0,
    why: 'no test files exist',
  },
  {
    id: 'i18n',
    label: 'internationalization',
    regex: /\b(internationalization|i18n|multi[- ]?language|localization)\b/gi,
    evidence: (ctx) => ctx.hasDependency(['i18next', 'next-intl', 'react-intl', 'vue-i18n', '@nuxtjs/i18n']) ||
      ctx.files.some((file) => /(^|\/)(locales?|i18n)\//.test(file.rel)),
    why: 'no i18n library or locale files exist',
  },
  {
    id: 'admin',
    label: 'admin tooling',
    regex: /\b(admin (dashboard|panel|console)|back[- ]office)\b/gi,
    evidence: (ctx) => ctx.routes.some((route) => /admin/i.test(route.path)) || ctx.files.some((file) => /(^|\/)admin\//.test(file.rel)),
    why: 'no admin route or admin module exists',
  },
];

const COMPLETION_CLAIMS = [
  /\bproduction[- ]ready\b/gi,
  /\bready (for|to) (production|ship|launch)\b/gi,
  /\bfully (functional|implemented|working)\b/gi,
  /\bfeature[- ]complete\b/gi,
  /\bbattle[- ]tested\b/gi,
  /\beverything works\b/gi,
  /\b100% (complete|done)\b/gi,
  /\bshipped\b/gi,
];

const DEMO_LABELS = /\b(prototype|mockup|mock-up|demo|proof of concept|poc|not for production)\b/gi;

export const claimRules = [
  {
    id: 'claim-without-implementation',
    category: 'hallucination',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'README or docs claim a capability that does not exist in the code.',
    hint: 'Implement the capability or remove the claim. Documentation must describe the system that exists, not the one that was imagined.',
    run(ctx) {
      for (const file of docs(ctx)) {
        const text = stripFences(file.text);
        for (const claim of CLAIMS) {
          for (const match of text.matchAll(claim.regex)) {
            if (negated(text, match.index)) continue;
            if (claim.evidence(ctx)) continue;
            ctx.report({
              file,
              index: match.index,
              message: `Docs claim ${claim.label} ("${match[0]}"), but ${claim.why}.`,
              data: { claim: claim.id },
            });
          }
        }
      }
    },
  },
  {
    id: 'checked-feature-without-evidence',
    category: 'hallucination',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'A checked-off roadmap item claims a feature with no implementation evidence.',
    hint: 'Uncheck it or implement it. Checking a box is not an implementation.',
    run(ctx) {
      for (const file of docs(ctx)) {
        for (const line of file.lines) {
          const checkbox = line.match(/^\s*[-*]\s*\[[xX]\]\s+(.+)$/);
          if (!checkbox) continue;
          const text = checkbox[1];
          if (/\b(mock|placeholder|coming soon|todo|tbd|not implemented)\b/i.test(text)) {
            ctx.report({
              file,
              index: file.text.indexOf(line),
              message: `Roadmap item is checked but still contains unfinished-work language: "${text.slice(0, 90)}".`,
            });
            continue;
          }
          for (const claim of CLAIMS) {
            const match = text.match(claim.regex);
            if (!match || negated(text, match.index ?? 0)) continue;
            if (claim.evidence(ctx)) continue;
            ctx.report({
              file,
              index: file.text.indexOf(line),
              message: `Checked roadmap item claims ${claim.label} but ${claim.why}: "${text.slice(0, 90)}".`,
              data: { claim: claim.id },
            });
          }
        }
      }
    },
  },
  {
    id: 'completion-claim-unproven',
    category: 'hallucination',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Docs claim the product is production-ready or complete without proof.',
    hint: 'Remove the claim until tests, evidence and the gate prove it. "Production ready" is a test result, not a sentence.',
    run(ctx) {
      const unfinished = ctx.sourceFiles.filter((file) => /\b(TODO|FIXME|HACK|not implemented|coming soon)\b/i.test(file.text));
      for (const file of docs(ctx)) {
        const text = stripFences(file.text);
        for (const regex of COMPLETION_CLAIMS) {
          for (const match of text.matchAll(regex)) {
            if (negated(text, match.index)) continue;
            const reasons = [];
            if (ctx.testFiles.length === 0) reasons.push('there are no tests');
            if (unfinished.length > 0) reasons.push(`${unfinished.length} source file(s) still contain unfinished-work markers`);
            if (ctx.deliveryMode === 'prototype') reasons.push('the facts say this is a prototype');
            if (ctx.factsEnabled && !ctx.factsMissing) {
              const unconfirmed = ctx.facts.filter((fact) => fact.required && fact.status !== 'confirmed');
              if (unconfirmed.length > 0) reasons.push(`${unconfirmed.length} required fact(s) are unconfirmed`);
            }
            if (reasons.length === 0) continue;
            ctx.report({
              file,
              index: match.index,
              message: `Completion claim "${match[0]}" is unsupported: ${reasons.join('; ')}.`,
            });
          }
        }
      }
    },
  },
  {
    id: 'delivery-mode-mismatch',
    category: 'contract',
    impact: 'completeness',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Docs describe a different delivery mode than the confirmed facts.',
    hint: 'Keep the facts and the README honest. A production project must not present itself as a demo, and a prototype must not claim production readiness.',
    run(ctx) {
      if (!ctx.deliveryMode) return;
      for (const file of docs(ctx)) {
        const text = stripFences(file.text);
        if (ctx.deliveryMode === 'production') {
          for (const match of text.matchAll(DEMO_LABELS)) {
            if (negated(text, match.index)) continue;
            ctx.report({ file, index: match.index, message: `Facts say production, but docs call it a ${match[0]}.` });
          }
        } else if (ctx.deliveryMode === 'prototype') {
          for (const regex of COMPLETION_CLAIMS) {
            for (const match of text.matchAll(regex)) {
              if (negated(text, match.index)) continue;
              ctx.report({ file, index: match.index, message: `Facts say prototype, but docs claim "${match[0]}".` });
            }
          }
        }
      }
    },
  },
];

function docs(ctx) {
  return ctx.files.filter((file) =>
    !file.isTest && !file.isGenerated && !file.isFixture &&
    (/(^|\/)(readme|changelog)\.mdx?$/i.test(file.rel) || /(^|\/)docs?\//.test(file.rel)),
  );
}

function negated(text, index) {
  if (index == null) return false;
  const before = text.slice(Math.max(0, index - 80), index).toLowerCase();
  return /\b(no|not|without|never|don't|doesn't|isn't|aren't|not yet|coming soon|planned|roadmap|future|tbd)\b[^.!?\n]{0,50}$/.test(before);
}

function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '));
}
