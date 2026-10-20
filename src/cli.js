import { runInit } from './commands/init.js';
import { runAudit } from './commands/audit.js';
import { runVerifyCommand } from './commands/verify.js';
import { runGate } from './commands/gate.js';
import { runBrief, runFacts } from './commands/brief.js';
import { runRules, runExplain } from './commands/rules.js';
import { runMcp } from './commands/mcp.js';
import { TOOL_VERSION } from './core/engine.js';

const VALUE_FLAGS = new Set([
  'cwd', 'tools', 'mode', 'strictness', 'rules', 'max-findings', 'fail-on', 'commands',
  'timeout', 'prompt', 'category', 'format', 'root',
]);

const HELP = `slag ${TOOL_VERSION} — anti-slop guardrails for AI-built web projects

Usage:
  slag init [--tools all|agents,opencode,claude,...] [--mode production|prototype]
            [--prompt "initial request"] [--force] [--hooks] [--no-ci]
  slag brief [--prompt "..."] [--json] [--force]
  slag facts [--json]
  slag audit [--json|--sarif|--markdown] [--strict|--relaxed]
             [--mode production|prototype] [--rules id,id] [--fail-on error|warn|none]
  slag verify [--install] [--commands build,test] [--json] [--mode ...]
  slag gate [--json] [--mode production|prototype]
  slag rules [--json] [--category name]
  slag explain <rule-id>
  slag mcp [--root dir]
  slag version

Global:
  --cwd <dir>        Project directory (default: current directory)
  --color/--no-color Force or disable ANSI output
  --quiet            Reduce output

Facts are the source of truth. Unknown required facts fail the production gate.
Verification evidence is written to .slag/evidence.json.
`;

export async function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === 'version' || argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${TOOL_VERSION}\n`);
    return;
  }

  const { command, flags, positional } = parseArgs(argv);
  const cwd = flags.cwd ? String(flags.cwd) : process.cwd();
  const context = { cwd, flags, positional };
  let code = 0;

  switch (command) {
    case 'init':
      code = await runInit(context);
      break;
    case 'brief':
      code = await runBrief(context);
      break;
    case 'facts':
      code = await runFacts(context);
      break;
    case 'audit':
      code = await runAudit(context);
      break;
    case 'verify':
      code = await runVerifyCommand(context);
      break;
    case 'gate':
      code = await runGate(context);
      break;
    case 'rules':
      code = await runRules(context);
      break;
    case 'explain':
      code = await runExplain(context);
      break;
    case 'mcp':
      code = await runMcp(context);
      break;
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
      code = 2;
  }
  if (code) process.exitCode = code;
}

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '-v') {
      flags[arg === '-h' ? 'help' : 'version'] = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    let key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (value === undefined && VALUE_FLAGS.has(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined) value = true;
    if (key.startsWith('no-') && (value === true || value === '')) {
      key = key.slice(3);
      value = false;
    }
    flags[key] = value;
  }
  return { command: positional.shift(), flags, positional };
}

export function listFlag(value) {
  if (!value || value === true) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

export function colorEnabled(flags) {
  if (flags.color === true) return true;
  if (flags.color === false || flags['no-color']) return false;
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}
