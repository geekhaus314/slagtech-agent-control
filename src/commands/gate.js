import { auditProject } from '../core/engine.js';
import { evaluateGate, fingerprintFiles, loadEvidence } from '../core/verify.js';
import { colorEnabled } from '../cli.js';
import { colorize, formatText } from '../report/text.js';
import { loadProject } from './shared.js';

export async function runGate({ flags }) {
  const { loaded, mode } = await loadProject(flags);
  const audit = await auditProject({ loaded, mode });
  const evidence = await loadEvidence(loaded.root);
  const fingerprint = await fingerprintFiles(loaded.root, loaded.config);
  const gate = evaluateGate({ audit, evidence, config: loaded.config, fingerprint });
  const json = Boolean(flags.json);
  const c = colorize(colorEnabled(flags));

  if (json) {
    process.stdout.write(`${JSON.stringify({
      gate,
      audit: {
        passed: audit.passed,
        score: audit.score,
        grade: audit.grade,
        summary: audit.summary,
        facts: { deliveryMode: audit.facts.deliveryMode, requiredUnconfirmed: audit.facts.requiredUnconfirmed, hash: audit.facts.hash },
        findings: audit.findings,
      },
      evidence: evidence ? {
        generatedAt: evidence.generatedAt,
        gitHead: evidence.gitHead,
        ok: evidence.ok,
        commands: evidence.commands?.map((command) => ({ name: command.name, ok: command.ok, exitCode: command.exitCode })),
      } : null,
    }, null, 2)}\n`);
  } else {
    if (!audit.passed) {
      process.stdout.write(formatText(audit, { color: colorEnabled(flags), showQuestions: true }));
      process.stdout.write('\n');
    }
    process.stdout.write(`${c.bold('slag gate')}\n`);
    for (const check of gate.checks) {
      const marker = check.ok ? c.green('PASS') : c.red('FAIL');
      process.stdout.write(`${marker} ${check.name} ${c.dim(check.message)}\n`);
    }
    process.stdout.write(gate.passed
      ? `\n${c.green(c.bold('Gate passed.'))} Evidence is fresh and the audit is clean.\n`
      : `\n${c.red(c.bold('Gate failed.'))} Fix the causes above, run \`slag verify\`, then re-run \`slag gate\`.\n`);
  }

  return gate.passed ? 0 : 1;
}
