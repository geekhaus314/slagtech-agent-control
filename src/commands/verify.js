import { auditProject } from '../core/engine.js';
import { detectCommands, runVerify } from '../core/verify.js';
import { colorEnabled, listFlag } from '../cli.js';
import { colorize } from '../report/text.js';
import { formatFor, loadProject } from './shared.js';

export async function runVerifyCommand({ flags }) {
  const { loaded, mode } = await loadProject(flags);
  const audit = await auditProject({ loaded, mode });
  const json = Boolean(flags.json);
  const quiet = Boolean(flags.quiet);
  const c = colorize(colorEnabled(flags));

  if (!json) {
    process.stdout.write(formatFor(audit, flags));
    const commands = await detectCommands(loaded.root, loaded.config, { only: listFlag(flags.commands) });
    if (commands.commands.length === 0) {
      process.stdout.write(`${c.yellow('No verification commands detected.')} Add build/test scripts or set commands in slag.config.json.\n`);
    }
  }

  const only = listFlag(flags.commands);
  const result = await runVerify({
    root: loaded.root,
    config: loaded.config,
    audit,
    install: Boolean(flags.install),
    only,
    timeoutMs: flags.timeout ? Number(flags.timeout) : null,
    onStart: (entry) => {
      if (json || quiet) return;
      process.stdout.write(`\n${c.bold('>')} ${entry.name}: ${c.dim(entry.command)}\n`);
    },
    onOutput: (chunk) => {
      if (json || quiet) return;
      process.stdout.write(chunk);
    },
  });

  const payload = {
    audit,
    verify: {
      ok: result.ok,
      evidencePath: result.evidencePath,
      commands: result.commands,
      detected: result.detected,
      manager: result.manager,
    },
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (quiet) {
    const failed = result.commands.filter((entry) => !entry.ok);
    process.stdout.write(result.ok && audit.passed
      ? `slag verify: pass · ${result.commands.length} command(s)\n`
      : `slag verify: fail · ${failed.map((entry) => entry.name).join(', ') || `${audit.summary.error} audit error(s)`}\n`);
  } else {
    process.stdout.write('\n');
    for (const command of result.commands) {
      const marker = command.ok ? c.green('PASS') : c.red('FAIL');
      const duration = `${(command.durationMs / 1000).toFixed(1)}s`;
      process.stdout.write(`${marker} ${command.name} ${c.dim(duration)}${command.timedOut ? c.red(' (timed out)') : ''}\n`);
    }
    process.stdout.write(`${c.dim('evidence')} ${result.evidencePath}\n`);
    process.stdout.write(result.ok && audit.passed
      ? `${c.green(c.bold('Verification passed.'))} Run \`slag gate\` to enforce it.\n`
      : `${c.red(c.bold('Verification failed.'))} Fix the failures, then re-run.\n`);
  }

  return result.ok && audit.passed ? 0 : 1;
}
