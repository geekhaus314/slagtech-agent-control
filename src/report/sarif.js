import { ruleCatalog } from '../rules/index.js';

const LEVEL = { error: 'error', warn: 'warning', info: 'note' };

export function formatSarif(audit) {
  const rules = ruleCatalog();
  const triggered = new Set(audit.findings.map((finding) => finding.rule));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'slag',
            version: audit.version,
            informationUri: 'https://github.com/geekhaus314/slagtech-agent-control',
            rules: rules.filter((rule) => triggered.has(rule.id)).map((rule) => ({
              id: rule.id,
              name: rule.id,
              shortDescription: { text: rule.description },
              fullDescription: { text: rule.hint },
              help: { text: rule.hint },
              properties: { category: rule.category, impact: rule.impact, defaultSeverity: rule.severity.standard },
            })),
          },
        },
        invocations: [{ executionSuccessful: audit.passed }],
        properties: { score: audit.score, grade: audit.grade, strictness: audit.strictness, deliveryMode: audit.facts?.deliveryMode ?? null },
        results: audit.findings.map((finding) => ({
          ruleId: finding.rule,
          level: LEVEL[finding.severity] ?? 'note',
          message: { text: finding.message },
          locations: finding.file
            ? [{
                physicalLocation: {
                  artifactLocation: { uri: finding.file.replaceAll('\\', '/') },
                  region: { startLine: Math.max(1, finding.line ?? 1), startColumn: Math.max(1, finding.column ?? 1) },
                },
              }]
            : [],
          properties: { hint: finding.hint, category: finding.category },
        })),
      },
    ],
  };
}
