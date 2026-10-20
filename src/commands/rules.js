import { getRule, ruleCatalog } from '../rules/index.js';
import { colorEnabled } from '../cli.js';
import { colorize } from '../report/text.js';

export async function runRules({ flags }) {
  let rules = ruleCatalog();
  if (flags.category) {
    const category = String(flags.category);
    rules = rules.filter((rule) => rule.category === category);
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(rules, null, 2)}\n`);
    return 0;
  }
  const c = colorize(colorEnabled(flags));
  process.stdout.write(`${c.bold('slag rules')} ${c.dim(`${rules.length} rules`)}\n\n`);
  const byCategory = new Map();
  for (const rule of rules) {
    if (!byCategory.has(rule.category)) byCategory.set(rule.category, []);
    byCategory.get(rule.category).push(rule);
  }
  for (const [category, entries] of [...byCategory.entries()].sort()) {
    process.stdout.write(`${c.bold(category)}\n`);
    for (const rule of entries) {
      const severity = rule.severity.standard;
      const color = severity === 'error' ? c.red : severity === 'warn' ? c.yellow : c.blue;
      process.stdout.write(`  ${color(severity.padEnd(5))} ${rule.id.padEnd(32)} ${c.dim(rule.description)}\n`);
    }
    process.stdout.write('\n');
  }
  process.stdout.write(c.dim('Use `slag explain <rule-id>` for the full rule and suppression syntax.\n'));
  return 0;
}

export async function runExplain({ flags, positional }) {
  const id = positional[0];
  if (!id) {
    process.stderr.write('Usage: slag explain <rule-id>\n');
    return 2;
  }
  const rule = getRule(id);
  if (!rule) {
    process.stderr.write(`Unknown rule "${id}". Run \`slag rules\` to list them.\n`);
    return 2;
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(rule, null, 2)}\n`);
    return 0;
  }
  const c = colorize(colorEnabled(flags));
  process.stdout.write(`${c.bold(rule.id)}\n`);
  process.stdout.write(`${c.dim(rule.category)} · impact: ${rule.impact}\n\n`);
  process.stdout.write(`${rule.description}\n\n`);
  process.stdout.write(`${c.bold('How to fix')}\n${rule.hint}\n\n`);
  process.stdout.write(`${c.bold('Default severity')}\n`);
  process.stdout.write(`  relaxed: ${rule.severity.relaxed}\n  standard: ${rule.severity.standard}\n  strict: ${rule.severity.strict}\n\n`);
  process.stdout.write(`${c.bold('Override in slag.config.json')}\n`);
  process.stdout.write(`  "rules": { "${rule.id}": "warn" }   // or "off", "info", "error"\n\n`);
  process.stdout.write(`${c.bold('Suppress one line')}\n`);
  process.stdout.write(`  // slag-disable-next-line ${rule.id} -- reason this is intentional\n`);
  return 0;
}
