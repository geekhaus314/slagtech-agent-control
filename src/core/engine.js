import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, severityFor } from './config.js';
import { collectFiles } from './files.js';
import { analyzeProject } from './analyze.js';
import { createMatcher } from './glob.js';
import { makeFinding, dedupeFindings, gradeFor, scoreFindings, sortFindings, summarize } from './findings.js';
import { RULES } from '../rules/index.js';
import { deliveryModeFromFacts, factSummary, factsHashValue, loadFacts } from './facts.js';

export const TOOL_VERSION = '0.1.0';

export async function auditProject(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const loaded = options.loaded ?? await loadConfig(cwd, { strictness: options.strictness });
  const { root, config } = loaded;
  const warnings = [...loaded.warnings];
  const loadedFacts = await loadFacts(root, config);
  const facts = loadedFacts.facts;
  const deliveryMode = deliveryModeFromFacts(facts, options.mode ?? (config.mode !== 'auto' ? config.mode : null));
  warnings.push(...loadedFacts.warnings);

  const collected = await collectFiles(root, config);
  warnings.push(...collected.warnings.map((warning) => warning.message));
  const analysis = analyzeProject({ files: collected.files, packageJson: collected.packageJson, config });
  const ruleIds = options.ruleIds?.length ? new Set(options.ruleIds) : null;
  const findings = [];
  const capabilities = await evaluateCapabilities(root, config, analysis, collected.files);

  const ctx = {
    root,
    config,
    warnings,
    ...analysis,
    files: collected.files,
    packageJson: collected.packageJson,
    capabilities,
    facts,
    factsEnabled: loadedFacts.enabled !== false,
    factsFile: loadedFacts.file,
    factsMissing: loadedFacts.missing,
    factsHash: factsHashValue(facts),
    deliveryMode,
    report(input) {
      findings.push(makeFinding({ rule: ctx.rule, severity: ctx.severity, ...input }));
    },
  };

  for (const rule of RULES) {
    if (ruleIds && !ruleIds.has(rule.id)) continue;
    const severity = severityFor(rule, config, deliveryMode);
    if (severity === 'off') continue;
    ctx.rule = rule;
    ctx.severity = severity;
    try {
      rule.run(ctx);
    } catch (error) {
      warnings.push(`Rule "${rule.id}" failed: ${error.message}`);
    }
  }

  const suppressed = applySuppressions(collected.files, findings);
  const filtered = dedupeFindings(suppressed.filter((finding) => !finding.file || !isIgnoredFile(finding.file, config)));
  const sorted = sortFindings(filtered);
  const summary = summarize(sorted, collected.files.length);
  const scoring = scoreFindings(sorted);
  const errors = summary.error;
  const passed = errors === 0;

  return {
    tool: 'slag',
    version: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    root,
    strictness: config.strictness,
    passed,
    status: passed ? 'pass' : 'fail',
    score: scoring.score,
    grade: gradeFor(scoring.score),
    summary,
    scoring,
    capabilities,
    facts: {
      file: loadedFacts.file,
      missing: loadedFacts.missing,
      deliveryMode,
      hash: factsHashValue(facts),
      ...factSummary(facts),
      items: facts,
      questions: facts.filter((fact) => fact.status !== 'confirmed').map((fact) => fact.id),
    },
    findings: sorted,
    warnings: [...new Set(warnings)],
    config: {
      source: loaded.source,
      rules: config.rules,
      verification: config.verification,
      commands: config.commands,
    },
  };
}

export function isIgnoredFile(rel, config) {
  return createMatcher(config.ignore ?? [])(rel);
}

async function evaluateCapabilities(root, config, analysis, files) {
  const results = [];
  for (const capability of config.capabilities) {
    const matched = new Set();
    for (const pattern of capability.evidence) {
      const matcher = createMatcher([pattern]);
      for (const file of files) {
        if (matcher(file.rel)) matched.add(file.rel);
      }
    }
    let status = 'proven';
    if (matched.size === 0) status = 'missing';
    else if (capability.verifiedBy) {
      status = 'unverified';
    }
    results.push({
      id: capability.id,
      description: capability.description ?? '',
      required: capability.required !== false,
      verifiedBy: capability.verifiedBy ?? null,
      status,
      evidence: [...matched].slice(0, 25),
    });
  }
  void root;
  void analysis;
  return results;
}

const DIRECTIVE = /slag-(disable-next-line|disable-line|disable|enable)\b([^\n]*)/;

export function applySuppressions(files, findings) {
  const byFile = new Map();
  for (const file of files) {
    const intervals = [];
    const singles = new Map();
    let block = null;
    let lineNo = 0;
    for (const line of file.lines) {
      lineNo += 1;
      const match = line.match(DIRECTIVE);
      if (!match) continue;
      const kind = match[1];
      const rules = parseRuleList(match[2]);
      if (kind === 'disable-line') singles.set(lineNo, rules);
      else if (kind === 'disable-next-line') singles.set(lineNo + 1, rules);
      else if (kind === 'disable') {
        block = { from: lineNo, rules };
      } else if (kind === 'enable' && block) {
        intervals.push({ from: block.from, to: lineNo, rules: mergeRuleSets(block.rules, rules) });
        block = null;
      }
    }
    if (block) intervals.push({ from: block.from, to: Number.POSITIVE_INFINITY, rules: block.rules });
    byFile.set(file.rel, { intervals, singles });
  }

  return findings.filter((finding) => {
    if (!finding.file || finding.line == null) return true;
    const entry = byFile.get(finding.file);
    if (!entry) return true;
    const single = entry.singles.get(finding.line);
    if (single && (single === null || single.has(finding.rule))) return false;
    for (const interval of entry.intervals) {
      if (finding.line >= interval.from && finding.line <= interval.to) {
        if (!interval.rules || interval.rules.has(finding.rule)) return false;
      }
    }
    return true;
  });
}

function parseRuleList(value) {
  const cleaned = value
    .replace(/-->/g, '')
    .replace(/\*\//g, '')
    .replace(/^[\s:—-]+/, '')
    .trim();
  if (!cleaned) return null;
  const rules = cleaned.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
  return rules.length ? new Set(rules) : null;
}

function mergeRuleSets(a, b) {
  if (!a || !b) return null;
  return new Set([...a, ...b]);
}

export async function writeJsonAtomic(absPath, value) {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, absPath);
}
