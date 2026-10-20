import { appFiles } from './helpers.js';
import { matchRoute } from '../core/analyze.js';

const LINK_TAG = /<(a|Link|NavLink|RouterLink|NuxtLink)\b([^>]*)>/gi;
const BUTTON_TAG = /<button\b([^>]*)>([\s\S]{0,240}?)<\/button>/gi;
const FORM_TAG = /<form\b([^>]*)>/gi;
const API_CALL = /\b(fetch|axios\.(get|post|put|patch|delete)|useSWR|useQuery)\s*\(\s*(['"`])(\/[^'"`]+)\3/g;

export const wiringRules = [
  {
    id: 'dead-link',
    category: 'wiring',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Links that point nowhere (#, empty, or javascript:).',
    hint: 'Point the link at a real route or remove it. href="#" is the clearest sign of a visual mockup.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        for (const match of file.text.matchAll(LINK_TAG)) {
          const href = attribute(match[2], 'href');
          if (href == null) continue;
          const value = unwrapValue(href);
          if (value == null) continue;
          if (value === '#' || value.trim() === '' || /^javascript:/i.test(value)) {
            ctx.report({
              file,
              index: match.index + match[0].indexOf(href),
              message: `Dead link target "${value || '(empty)'}".`,
            });
          }
        }
      }
    },
  },
  {
    id: 'inert-button',
    category: 'wiring',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'warn', strict: 'error' },
    description: 'Buttons with no click handler, submit role, or navigation.',
    hint: 'Wire the button to a real action. If it is decorative, it should not be a button.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        for (const match of file.text.matchAll(BUTTON_TAG)) {
          const attrs = match[1];
          if (hasWiringAttribute(attrs)) continue;
          if (/\sdisabled(?:\s|=|>)/i.test(attrs)) continue;
          const before = file.text.slice(0, match.index);
          if (isInsideOpenForm(file.text, before)) continue;
          const label = match[2].replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ').trim().slice(0, 60);
          ctx.report({
            file,
            index: match.index,
            message: `Button has no action wired${label ? `: "${label}"` : ''}.`,
          });
        }
      }
    },
  },
  {
    id: 'dead-form',
    category: 'wiring',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Forms with no submission target or handler.',
    hint: 'Wire the form to a server action, API route, or submit handler. A form that goes nowhere collects nothing.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        for (const match of file.text.matchAll(FORM_TAG)) {
          const attrs = match[1];
          if (hasFormWiring(attrs)) continue;
          ctx.report({
            file,
            index: match.index,
            message: 'Form has no action, submit handler, or server action.',
          });
        }
      }
    },
  },
  {
    id: 'phantom-api',
    category: 'hallucination',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Frontend calls a local API endpoint that does not exist in the codebase.',
    hint: 'Implement the endpoint or correct the URL. Do not ship a client that calls an imagined backend.',
    run(ctx) {
      const seen = new Set();
      for (const file of appFiles(ctx)) {
        if (!file.isCode) continue;
        for (const match of file.text.matchAll(API_CALL)) {
          const endpoint = match[4];
          if (endpoint.includes('${') || endpoint.includes('{')) continue;
          if (!endpoint.startsWith('/api/') && endpoint !== '/api') continue;
          const path = endpoint.split('?')[0].replace(/\/$/, '') || '/';
          if (matchRoute(path, ctx.apiMatchers)) continue;
          const key = `${path}|${file.rel}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ctx.report({
            file,
            index: match.index,
            message: `Client calls "${endpoint}" but no matching route handler exists.`,
            data: { endpoint },
          });
        }
      }
    },
  },
  {
    id: 'unresolved-internal-link',
    category: 'wiring',
    impact: 'behavior',
    severity: { relaxed: 'info', standard: 'warn', strict: 'error' },
    description: 'Internal links that do not resolve to a route or public asset.',
    hint: 'Build the destination or remove the link. Navigation to pages that do not exist is unfinished work.',
    run(ctx) {
      if (ctx.routes.length < 2) return;
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        for (const match of file.text.matchAll(LINK_TAG)) {
          const href = attribute(match[2], 'href');
          if (href == null) continue;
          const raw = unwrapValue(href);
          if (raw == null || raw === '#' || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
          if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('javascript:')) continue;
          if (!raw.startsWith('/')) continue;
          if (raw.includes('${') || raw.includes('{') || raw.includes(':')) continue;
          const path = raw.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';
          if (path.startsWith('/api/')) continue;
          if (ctx.publicAssets.has(path)) continue;
          if (/\.(png|jpe?g|svg|webp|avif|gif|ico|css|js|txt|xml|pdf|woff2?)$/i.test(path)) continue;
          if (matchRoute(path, ctx.routeMatchers)) continue;
          ctx.report({
            file,
            index: match.index + match[0].indexOf(href),
            message: `Internal link "${raw}" does not resolve to a known route.`,
            data: { path },
          });
        }
      }
    },
  },
  {
    id: 'form-endpoint-missing',
    category: 'hallucination',
    impact: 'behavior',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'Form action points at a local API endpoint that does not exist.',
    hint: 'Implement the endpoint or use a real server action. A form posting to an imagined route silently loses user data.',
    run(ctx) {
      for (const file of appFiles(ctx)) {
        if (!file.isCode && !file.isMarkup) continue;
        for (const match of file.text.matchAll(FORM_TAG)) {
          const action = attribute(match[1], 'action');
          if (action == null) continue;
          const raw = unwrapValue(action);
          if (raw == null || !raw.startsWith('/api/')) continue;
          if (raw.includes('${') || raw.includes('{')) continue;
          const path = raw.split('?')[0].replace(/\/$/, '');
          if (matchRoute(path, ctx.apiMatchers)) continue;
          ctx.report({
            file,
            index: match.index,
            message: `Form action "${raw}" has no matching API route.`,
          });
        }
      }
    },
  },
];

function attribute(attrs, name) {
  if (!attrs) return null;
  const regex = new RegExp(`\\b${name}\\s*=\\s*(\\{[^}]*\\}|"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const match = attrs.match(regex);
  return match ? match[1] : null;
}

function unwrapValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    const quote = inner[0];
    if ((quote === '"' || quote === "'" || quote === '`') && inner.endsWith(quote)) {
      return inner.slice(1, -1);
    }
    return null;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function hasWiringAttribute(attrs) {
  return /\b(onClick|on:click|@click|onSubmit|on:submit|@submit|onPress|formAction|href|type\s*=\s*["']submit["']|hx-(get|post|put|patch|delete)|data-action)\b/i.test(attrs);
}

function hasFormWiring(attrs) {
  return /\b(action|onSubmit|on:submit|@submit|hx-post|hx-put|hx-patch|hx-delete|method\s*=\s*["']dialog["'])\b/i.test(attrs);
}

function isInsideOpenForm(text, before) {
  const lastOpen = before.lastIndexOf('<form');
  if (lastOpen === -1) return false;
  const lastClose = before.lastIndexOf('</form>');
  return lastOpen > lastClose;
}
