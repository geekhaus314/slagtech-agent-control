import { loadConfig } from '../core/config.js';
import { formatText } from '../report/text.js';
import { formatSarif } from '../report/sarif.js';
import { formatMarkdown } from '../report/markdown.js';
import { colorEnabled } from '../cli.js';

export async function loadProject(flags = {}) {
  const cwd = flags.cwd ? String(flags.cwd) : process.cwd();
  const strictness = flags.strict ? 'strict' : flags.relaxed ? 'relaxed' : (flags.strictness ? String(flags.strictness) : undefined);
  const loaded = await loadConfig(cwd, { strictness });
  if (flags.facts === false) loaded.config.factsFile = null;
  const mode = normalizeMode(flags.mode);
  return { loaded, mode, cwd };
}

export function normalizeMode(value) {
  if (!value || value === true) return null;
  const mode = String(value).toLowerCase();
  if (['production', 'prod'].includes(mode)) return 'production';
  if (['prototype', 'mockup', 'demo'].includes(mode)) return 'prototype';
  return null;
}

export function formatFor(audit, flags) {
  if (flags.sarif) return `${JSON.stringify(formatSarif(audit), null, 2)}\n`;
  if (flags.markdown) return formatMarkdown(audit);
  if (flags.json) return `${JSON.stringify(audit, null, 2)}\n`;
  if (flags.quiet) {
    return audit.passed
      ? ''
      : `slag: ${audit.summary.error} error(s), ${audit.summary.warn} warning(s) — ${audit.score}/100\n`;
  }
  return formatText(audit, {
    color: colorEnabled(flags),
    maxFindings: flags['max-findings'] ? Number(flags['max-findings']) : undefined,
  });
}

export function exitCodeFor(audit, flags) {
  const failOn = typeof flags['fail-on'] === 'string' ? flags['fail-on'] : 'error';
  if (failOn === 'none') return 0;
  if (failOn === 'warn') return audit.summary.warn + audit.summary.error > 0 ? 1 : 0;
  return audit.passed ? 0 : 1;
}
