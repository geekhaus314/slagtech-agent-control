import { columnOf, excerptAt, lineOf } from './files.js';

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2, off: 3 };
export const SEVERITY_WEIGHT = { error: 6, warn: 2, info: 0.25 };
export const CATEGORY_WEIGHT = {
  security: 1.8,
  backend: 1.35,
  wiring: 1.35,
  stubs: 1.2,
  contract: 1.4,
  content: 1,
  quality: 0.75,
  process: 0.6,
};

const RULE_CAP = 6;

export function makeFinding({ rule, file, index, line, message, hint, severity, data }) {
  const rel = typeof file === 'string' ? file : file?.rel;
  const text = typeof file === 'string' ? null : file?.text;
  let resolvedLine = line ?? null;
  let column = null;
  let excerpt = null;
  if (index != null && text) {
    resolvedLine = lineOf(text, index);
    column = columnOf(text, index);
    excerpt = excerptAt(text, index);
  } else if (resolvedLine != null && text) {
    excerpt = text.split(/\r?\n/)[resolvedLine - 1]?.trim().slice(0, 140) ?? null;
  }
  return {
    rule: rule.id,
    category: rule.category,
    impact: rule.impact ?? 'behavior',
    severity: severity ?? 'warn',
    message,
    file: rel ?? null,
    line: resolvedLine,
    column,
    excerpt,
    hint: hint ?? rule.hint,
    data: data ?? null,
  };
}

export function summarize(findings, filesScanned) {
  const counts = { error: 0, warn: 0, info: 0 };
  const rules = new Map();
  const files = new Set();
  for (const finding of findings) {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    rules.set(finding.rule, (rules.get(finding.rule) ?? 0) + 1);
    if (finding.file) files.add(finding.file);
  }
  return {
    ...counts,
    total: findings.length,
    filesScanned,
    filesWithFindings: files.size,
    rulesTriggered: rules.size,
  };
}

export function scoreFindings(findings) {
  const perRule = new Map();
  for (const finding of findings) {
    perRule.set(finding.rule, (perRule.get(finding.rule) ?? 0) + 1);
  }
  let raw = 0;
  const breakdown = [];
  for (const [ruleId, count] of perRule) {
    const sample = findings.find((finding) => finding.rule === ruleId);
    const severity = sample?.severity ?? 'warn';
    const category = sample?.category ?? 'quality';
    const capped = Math.min(count, RULE_CAP);
    const penalty = capped * (SEVERITY_WEIGHT[severity] ?? 1) * (CATEGORY_WEIGHT[category] ?? 1);
    raw += penalty;
    breakdown.push({ rule: ruleId, count, capped, penalty: round(penalty) });
  }
  breakdown.sort((a, b) => b.penalty - a.penalty);
  const score = Math.max(0, Math.min(100, Math.round(100 - raw)));
  return { score, penalty: round(raw), breakdown };
}

export function gradeFor(score) {
  if (score >= 95) return 'A';
  if (score >= 85) return 'B';
  if (score >= 70) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const severity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (severity !== 0) return severity;
    const file = String(a.file ?? '~').localeCompare(String(b.file ?? '~'));
    if (file !== 0) return file;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

function round(value) {
  return Math.round(value * 10) / 10;
}

export function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const finding of findings) {
    const key = `${finding.rule}|${finding.file}|${finding.line}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}
