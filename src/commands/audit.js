import { auditProject } from '../core/engine.js';
import { listFlag } from '../cli.js';
import { exitCodeFor, formatFor, loadProject } from './shared.js';

export async function runAudit({ flags }) {
  const { loaded, mode } = await loadProject(flags);
  const audit = await auditProject({
    loaded,
    mode,
    ruleIds: listFlag(flags.rules),
  });
  process.stdout.write(formatFor(audit, flags));
  return exitCodeFor(audit, flags);
}
