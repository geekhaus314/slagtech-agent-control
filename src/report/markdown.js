export function formatMarkdown(audit) {
  const lines = [];
  lines.push('# Slag audit');
  lines.push('');
  lines.push(`**Status:** ${audit.passed ? 'pass' : 'fail'} · **Score:** ${audit.score}/100 (${audit.grade}) · **Mode:** ${audit.facts?.deliveryMode ?? 'unconfirmed'} · **Strictness:** ${audit.strictness}`);
  lines.push('');
  lines.push('| Errors | Warnings | Info | Files |');
  lines.push('| ---: | ---: | ---: | ---: |');
  lines.push(`| ${audit.summary.error} | ${audit.summary.warn} | ${audit.summary.info} | ${audit.summary.filesScanned} |`);
  lines.push('');

  if (audit.facts?.total > 0) {
    lines.push('## Facts');
    lines.push('');
    lines.push('| Fact | Status | Value |');
    lines.push('| --- | --- | --- |');
    for (const fact of audit.facts.items) {
      lines.push(`| \`${fact.id}\` | ${fact.status} | ${truncate(String(fact.value ?? '—'), 80)} |`);
    }
    lines.push('');
  }

  lines.push('## Findings');
  lines.push('');
  if (audit.findings.length === 0) {
    lines.push('No findings.');
  } else {
    lines.push('| Severity | Rule | Location | Message |');
    lines.push('| --- | --- | --- | --- |');
    for (const finding of audit.findings) {
      const location = finding.file ? `\`${finding.file}${finding.line ? `:${finding.line}` : ''}\`` : '—';
      lines.push(`| ${finding.severity} | \`${finding.rule}\` | ${location} | ${escapeCell(finding.message)} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
