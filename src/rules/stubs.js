import { appFiles, forEachMatch } from './helpers.js';

const TODO = /\b(TODO|FIXME|XXX|HACK)\b[^\n]*/g;
const NOT_IMPLEMENTED = /(throw new Error\s*\(\s*['"`](not implemented|unimplemented|todo|not yet)|NotImplementedError|unimplemented!|todo!\s*\()/gi;
const EMPTY_HANDLER = /\bon[A-Z][A-Za-z0-9_]*\s*=\s*\{\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(\{\s*\}|console\.(?:log|debug|info)\s*\([^)]*\)|alert\s*\([^)]*\)|void 0|undefined|null|Promise\.resolve\s*\(\s*\))/g;
const EMPTY_NAMED_HANDLER = /\b(?:function|const|let|var)\s+(?:handle|on)[A-Z]\w*\s*(?:=\s*)?(?:async\s*)?\([^)]*\)\s*(?:=>\s*)?\{\s*\}/g;
const VUE_EMPTY = /(?:@click|v-on:click|@submit|v-on:submit)\s*=\s*["']\s*(?:\(\s*\)\s*=>\s*\{\s*\}|console\.log\([^)]*\)|alert\([^)]*\))?\s*["']/g;
const MOCK_IDENTIFIER = /\b(mockData|dummyData|fakeData|sampleData|mockUsers|fakeUsers|dummyUsers|mockProducts|fakeProducts|MOCK_[A-Z0-9_]+|DUMMY_[A-Z0-9_]+)\b/;
const DEMO_ARTIFACT = /\b(DEMO_MODE|demoMode|isDemoMode|NEXT_PUBLIC_DEMO|VITE_DEMO|PUBLIC_DEMO|mock mode|demo only|for (demo|demonstration) purposes?|demo data|example data|placeholder data|fake data|dummy data|sample data)\b/gi;
const FAKE_DELAY = /(setTimeout\s*\([^)]{0,160}\)|new Promise\s*\(\s*(?:resolve|\(resolve\))\s*=>\s*setTimeout)/g;
const CLIENT_STORAGE = /\b(localStorage|sessionStorage)\.(setItem|getItem)\s*\(\s*['"`]([^'"`]+)['"`]/g;

export const stubRules = [
  {
    id: 'todo-markers',
    category: 'stubs',
    impact: 'completeness',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Unfinished-work markers left in application code.',
    hint: 'Implement it now or move it to an issue tracker. A TODO is not an implementation and does not prove a feature works.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isStyle) continue;
        const matches = [...file.text.matchAll(TODO)];
        if (matches.length === 0) continue;
        for (const match of matches) {
          const kind = match[1];
          ctx.report({
            file,
            index: match.index,
            severity: kind === 'TODO' ? undefined : 'error',
            message: `${kind} left in application code.`,
            data: { kind },
          });
        }
        if (matches.length > (ctx.config.limits?.maxTodo ?? 8)) {
          ctx.report({
            file,
            line: 1,
            severity: 'error',
            message: `${matches.length} unfinished-work markers in one file; this file is not complete.`,
          });
        }
      }
    },
  },
  {
    id: 'not-implemented',
    category: 'stubs',
    impact: 'completeness',
    severity: { relaxed: 'error', standard: 'error', strict: 'error' },
    description: 'Code paths that explicitly throw or report that they are not implemented.',
    hint: 'Implement the path. If it genuinely cannot be supported, remove the surface that exposes it.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        forEachMatch(file, NOT_IMPLEMENTED, (match) => {
          ctx.report({ file, index: match.index, message: `Unimplemented code path: "${match[0]}".` });
        });
      }
    },
  },
  {
    id: 'empty-handler',
    category: 'stubs',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Click/submit handlers that do nothing or only log/alert.',
    hint: 'Wire the control to real behavior: state change, API call, navigation, or mutation. A button that only logs is a mockup.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        for (const regex of [EMPTY_HANDLER, EMPTY_NAMED_HANDLER, VUE_EMPTY]) {
          forEachMatch(file, regex, (match) => {
            ctx.report({ file, index: match.index, message: `Inert event handler: "${match[0].slice(0, 90)}".` });
          });
        }
      }
    },
  },
  {
    id: 'mock-data-in-prod',
    category: 'stubs',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Mock or sample data wired into the product instead of a real data source.',
    hint: 'Replace the mock with a real query or API call. If the UI needs a fallback, make it explicit and test it.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        if (/(^|\/)(seeds?|fixtures?|mocks?|stories|examples?|demo)\//i.test(file.rel)) continue;
        if (MOCK_IDENTIFIER.test(file.text) || /\bfrom\s+['"][^'"]*(mock|fixtures?)[^'"]*['"]/.test(file.text)) {
          const match = file.text.match(MOCK_IDENTIFIER) ?? file.text.match(/\bfrom\s+['"][^'"]*(mock|fixtures?)[^'"]*['"]/);
          ctx.report({
            file,
            index: match?.index,
            message: 'Mock/sample data is imported by product code.',
          });
        }
      }
    },
  },
  {
    id: 'demo-artifacts',
    category: 'stubs',
    impact: 'demo-content',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Demo flags, banners or demo-only data paths left in product code.',
    hint: 'Remove demo scaffolding from the production path. Demo mode is not a substitute for working behavior.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        forEachMatch(file, DEMO_ARTIFACT, (match) => {
          ctx.report({ file, index: match.index, message: `Demo artifact in product code: "${match[0]}".` });
        });
      }
    },
  },
  {
    id: 'fake-latency',
    category: 'stubs',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Artificial delays used to make mock behavior feel real.',
    hint: 'Remove simulated latency. If a loading state needs to be tested, do it in a test or story, not in product code.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        forEachMatch(file, FAKE_DELAY, (match) => {
          const around = file.text.slice(Math.max(0, match.index - 160), match.index + match[0].length + 120);
          if (!/\b(simulate|fake|mock|demo|artificial|pretend|delay)\b/i.test(around)) return;
          ctx.report({ file, index: match.index, message: 'Artificial delay used to simulate a backend.' });
        });
      }
    },
  },
  {
    id: 'local-only-state',
    category: 'backend',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'User or application data persisted only in browser storage.',
    hint: 'Move durable state to a server-side store. Browser storage is per-device and trivially editable; do not present it as accounts or persistence.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        forEachMatch(file, CLIENT_STORAGE, (match) => {
          if (!/\b(user|auth|token|session|account|profile|order|cart|data|items|posts|todos|records)\b/i.test(match[3])) return;
          ctx.report({
            file,
            index: match.index,
            message: `"${match[3]}" is stored only in ${match[1]}; there is no server-side record.`,
            data: { key: match[3] },
          });
        });
      }
    },
  },
  {
    id: 'disabled-cta',
    category: 'wiring',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'warn' },
    description: 'Primary call-to-action permanently disabled in markup.',
    hint: 'Wire the action or remove the CTA. A disabled "Get started"/"Sign up"/"Buy" button is a mockup artifact unless a real condition controls it.',
    run(ctx) {
      const cta = /\b(get started|start free|sign up|sign in|log in|create account|subscribe|buy now|purchase|upgrade|book (a )?(demo|call)|contact sales|join now|try it|start trial)\b/i;
      for (const file of appFiles(ctx)) {
        if (!file.isMarkup && !file.isCode) continue;
        const button = /<button([^>]*)>([\s\S]{0,200}?)<\/button>/gi;
        for (const match of file.text.matchAll(button)) {
          const attrs = match[1];
          if (!/\sdisabled(?:\s|=|>)/i.test(attrs) && !/\sdisabled=\{\s*true\s*\}/i.test(attrs)) continue;
          if (!cta.test(stripTags(match[2]))) continue;
          ctx.report({ file, index: match.index, message: `Primary CTA is permanently disabled: "${stripTags(match[2]).trim().slice(0, 50)}".` });
        }
      }
    },
  },
];

function stripTags(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ');
}
