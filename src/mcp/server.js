import { TOOL_VERSION } from '../core/engine.js';
import { runAudit } from '../commands/audit.js';
import { runVerifyCommand } from '../commands/verify.js';
import { runGate } from '../commands/gate.js';
import { runBrief, runFacts } from '../commands/brief.js';
import { runRules, runExplain } from '../commands/rules.js';

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'slag_audit',
    description: 'Run the static anti-slop audit. Returns findings for placeholders, dead UI, mock backends, fake auth, hallucinated imports/APIs, README claims that contradict the code, and unconfirmed facts.',
    inputSchema: {
      type: 'object',
      properties: {
        strict: { type: 'boolean', description: 'Use strict severity.' },
        mode: { type: 'string', enum: ['production', 'prototype'], description: 'Override the delivery mode from facts.' },
        rules: { type: 'array', items: { type: 'string' }, description: 'Limit to these rule ids.' },
      },
    },
  },
  {
    name: 'slag_verify',
    description: 'Run the audit plus the project build, typecheck, lint, test and e2e commands, then write fresh evidence to .slag/evidence.json. Use this before claiming a task is done.',
    inputSchema: {
      type: 'object',
      properties: {
        install: { type: 'boolean', description: 'Run the package install step first.' },
        commands: { type: 'array', items: { type: 'string' }, description: 'Only run these command names.' },
        mode: { type: 'string', enum: ['production', 'prototype'] },
      },
    },
  },
  {
    name: 'slag_gate',
    description: 'Enforce completion: audit must pass, required facts must be confirmed, verification evidence must be fresh, and every recorded command must have passed. Call this before saying the work is done.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'slag_facts',
    description: 'Read the project facts contract: confirmed/assumed/unknown stack, scope, data, auth, deployment and acceptance criteria.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'slag_brief',
    description: 'Return the intake questions that must be answered by the user before writing code. If the facts file is missing, this creates it. Does not invent answers.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Initial user request, used only to pre-fill assumptions that still need confirmation.' },
        mode: { type: 'string', enum: ['production', 'prototype'] },
        force: { type: 'boolean', description: 'Regenerate while preserving confirmed facts.' },
      },
    },
  },
  {
    name: 'slag_rules',
    description: 'List every audit rule, its category and default severity, with fix guidance.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string' } },
    },
  },
  {
    name: 'slag_explain',
    description: 'Explain one rule, including fix guidance, severity and suppression syntax.',
    inputSchema: {
      type: 'object',
      properties: { rule: { type: 'string', description: 'Rule id, e.g. mutation-without-side-effect.' } },
      required: ['rule'],
    },
  },
  {
    name: 'slag_status',
    description: 'Compact project status: audit summary, fact confirmation, delivery mode and evidence freshness.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export function createMcpServer({ root = process.cwd(), input = process.stdin, output = process.stdout, error = process.stderr } = {}) {
  let buffer = '';
  let contentLength = null;
  let initialized = false;
  let consuming = false;
  let again = false;

  const send = (payload) => {
    output.write(`${JSON.stringify(payload)}\n`);
  };

  const handle = async (message) => {
    if (!message || typeof message !== 'object') return;
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;

    if (method === 'initialize') {
      initialized = true;
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'slag', version: TOOL_VERSION },
          instructions: 'Slag enforces facts-first, evidence-based completion. Read slag.facts.json, ask the user any open questions, then build. Call slag_verify and slag_gate before claiming done.',
        },
      });
    }
    if (method === 'notifications/initialized') return undefined;
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'shutdown') {
      send({ jsonrpc: '2.0', id, result: null });
      setTimeout(() => process.exit(0), 10).unref();
      return undefined;
    }
    if (method === 'exit') {
      process.exit(0);
      return undefined;
    }
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }
    if (method === 'tools/call') {
      const { name, arguments: args = {} } = params ?? {};
      try {
        const result = await callTool(name, args, root);
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } });
      } catch (toolError) {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `slag tool error: ${toolError.message}` }], isError: true } });
      }
      return undefined;
    }
    if (isNotification) return undefined;
    return send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  };

  const consume = async () => {
    if (consuming) {
      again = true;
      return;
    }
    consuming = true;
    try {
    while (true) {
      if (contentLength != null) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        buffer = buffer.slice(headerEnd + 4);
        const body = buffer.slice(0, contentLength);
        if (body.length < contentLength) {
          buffer = `${body}${buffer.slice(body.length)}`;
          return;
        }
        buffer = buffer.slice(contentLength);
        contentLength = null;
        await dispatch(body);
        continue;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      if (/^content-length:/i.test(line)) {
        const match = line.match(/^content-length:\s*(\d+)/i);
        if (match) contentLength = Number(match[1]);
        continue;
      }
      await dispatch(line);
    }
    } finally {
      consuming = false;
      if (again) {
        again = false;
        void consume();
      }
    }
  };

  const dispatch = async (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    await handle(message);
  };

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    void consume();
  });
  input.on('end', () => process.exit(0));
  error.write(`slag mcp ${TOOL_VERSION} ready (${root})\n`);
  return { close: () => input.pause(), isInitialized: () => initialized };
}

export async function callTool(name, args, root) {
  const flags = { cwd: root, json: true };
  if (args.strict) flags.strict = true;
  if (args.mode) flags.mode = args.mode;
  if (args.install) flags.install = true;
  if (args.force) flags.force = true;
  if (args.prompt) flags.prompt = args.prompt;
  if (args.category) flags.category = args.category;
  if (Array.isArray(args.rules) && args.rules.length) flags.rules = args.rules.join(',');
  if (Array.isArray(args.commands) && args.commands.length) flags.commands = args.commands.join(',');

  switch (name) {
    case 'slag_audit':
      return capture(() => runAudit({ flags }));
    case 'slag_verify':
      return capture(() => runVerifyCommand({ flags }));
    case 'slag_gate':
      return capture(() => runGate({ flags }));
    case 'slag_facts':
      return capture(() => runFacts({ flags }));
    case 'slag_brief':
      return capture(() => runBrief({ flags }));
    case 'slag_rules':
      return capture(() => runRules({ flags }));
    case 'slag_explain':
      return capture(() => runExplain({ flags, positional: [args.rule] }));
    case 'slag_status':
      return status(root);
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

async function status(root) {
  const auditResult = JSON.parse(await capture(() => runAudit({ flags: { cwd: root, json: true } })));
  const gateResult = JSON.parse(await capture(() => runGate({ flags: { cwd: root, json: true } })));
  return JSON.stringify({
    score: auditResult.score,
    grade: auditResult.grade,
    passed: auditResult.passed,
    summary: auditResult.summary,
    deliveryMode: auditResult.facts?.deliveryMode ?? null,
    facts: {
      requiredConfirmed: auditResult.facts?.requiredConfirmed,
      requiredTotal: auditResult.facts?.requiredTotal,
      requiredUnconfirmed: auditResult.facts?.requiredUnconfirmed,
    },
    gate: gateResult.gate,
    evidence: gateResult.evidence,
    topFindings: auditResult.findings.slice(0, 8),
  }, null, 2);
}

async function capture(fn) {
  const chunks = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  };
  try {
    const code = await fn();
    return chunks.join('').trim() || JSON.stringify({ exitCode: code });
  } finally {
    process.stdout.write = original;
  }
}
