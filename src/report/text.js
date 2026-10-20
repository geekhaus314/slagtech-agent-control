const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  green: '\u001b[32m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
};

export function colorize(enabled) {
  if (!enabled) {
    return Object.fromEntries(Object.keys(ANSI).map((key) => [key, (value) => value]));
  }
  return Object.fromEntries(Object.entries(ANSI).map(([key, code]) => [key, (value) => `${code}${value}${ANSI.reset}`]));
}

const BADGE = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };

export function formatText(audit, options = {}) {
  const useColor = options.color ?? (Boolean(process.stdout.isTTY) && !process.env.NO_COLOR);
  const c = colorize(useColor);
  const lines = [];
  const facts = audit.facts;
  const mode = facts?.deliveryMode ?? 'unconfirmed';
  const header = `${c.bold('slag')} ${audit.version}  ${c.dim('·')} ${audit.strictness}  ${c.dim('·')} ${mode}`;
  lines.push(header);
  lines.push(`${c.dim(audit.root)}`);
  if (facts && facts.total > 0) {
    const confirmed = facts.requiredConfirmed;
    const total = facts.requiredTotal;
    const factColor = confirmed === total ? c.green : c.yellow;
    lines.push(`${c.dim('facts')} ${factColor(`${confirmed}/${total} required confirmed`)} ${c.dim(`(${facts.total} total)`)}`);
  }
  if (!facts?.missing && audit.facts?.questions?.length > 0 && options.showQuestions !== false) {
    const unknown = audit.facts.items.filter((fact) => fact.required && fact.status !== 'confirmed');
    if (unknown.length > 0) {
      lines.push('');
      lines.push(c.yellow('Questions still open:'));
      for (const fact of unknown.slice(0, 6)) {
        lines.push(`  ${c.yellow('?')} ${c.bold(fact.id)} ${c.dim(`[${fact.status}]`)} ${fact.question}`);
      }
      if (unknown.length > 6) lines.push(c.dim(`  …and ${unknown.length - 6} more. Run \`slag brief\`.`));
    }
  }

  const grouped = { error: [], warn: [], info: [] };
  for (const finding of audit.findings) (grouped[finding.severity] ?? grouped.info).push(finding);
  const max = options.maxFindings ?? Infinity;
  let shown = 0;

  for (const severity of ['error', 'warn', 'info']) {
    const findings = grouped[severity];
    if (findings.length === 0) continue;
    lines.push('');
    lines.push(`${severityColor(c, severity)(c.bold(`${BADGE[severity]} (${findings.length})`))}`);
    for (const finding of findings) {
      if (shown >= max) {
        lines.push(c.dim('  …output truncated; use --json for the full report.'));
        shown += 1;
        break;
      }
      shown += 1;
      const location = finding.file ? `${c.cyan(finding.file)}${finding.line ? c.dim(`:${finding.line}`) : ''}` : c.dim('(project)');
      lines.push(`  ${severityColor(c, severity)(BADGE[severity])} ${c.bold(finding.rule)} ${location}`);
      lines.push(`        ${finding.message}`);
      if (finding.hint && options.hints !== false) lines.push(`        ${c.dim(`fix: ${finding.hint}`)}`);
    }
  }

  if (audit.findings.length === 0) {
    lines.push('');
    lines.push(c.green('No findings. Audit passed.'));
  }

  lines.push('');
  const summary = audit.summary;
  const scoreColor = audit.score >= 85 ? c.green : audit.score >= 70 ? c.yellow : c.red;
  lines.push(
    `${scoreColor(c.bold(`${audit.score}/100 (${audit.grade})`))}  ` +
    `${c.red(`${summary.error} error`)}  ${c.yellow(`${summary.warn} warn`)}  ${c.dim(`${summary.info} info`)}  ` +
    `${c.dim(`${summary.filesScanned} files`)}`,
  );
  if (audit.capabilities?.length) {
    const proven = audit.capabilities.filter((capability) => capability.status === 'proven').length;
    const total = audit.capabilities.filter((capability) => capability.required).length;
    lines.push(`${c.dim('capabilities')} ${proven}/${total} have evidence`);
  }
  if (audit.warnings?.length) {
    lines.push(c.dim(`${audit.warnings.length} internal warning(s); use --json to inspect.`));
  }
  lines.push(c.dim('Suppress a specific line with: // slag-disable-next-line <rule-id>'));
  return `${lines.join('\n')}\n`;
}

function severityColor(c, severity) {
  if (severity === 'error') return c.red;
  if (severity === 'warn') return c.yellow;
  return c.blue;
}
