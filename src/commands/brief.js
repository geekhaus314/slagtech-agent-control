import path from 'node:path';
import {
  buildDefaultFacts,
  deliveryModeFromFacts,
  factSummary,
  inferFactsFromPrompt,
  loadFacts,
  questionsFor,
} from '../core/facts.js';
import { writeJsonAtomic } from '../core/engine.js';
import { colorEnabled, listFlag } from '../cli.js';
import { colorize } from '../report/text.js';
import { loadProject, normalizeMode } from './shared.js';

export async function runBrief({ flags }) {
  const { loaded } = await loadProject(flags);
  const { root, config } = loaded;
  const abs = path.join(root, config.factsFile ?? 'slag.facts.json');
  const existing = await loadFacts(root, config);
  let facts = existing.facts;
  let created = false;

  if (existing.missing || flags.force) {
    const inferred = inferFactsFromPrompt(flags.prompt ? String(flags.prompt) : '');
    facts = existing.missing ? inferred.facts : mergeFacts(existing.facts, inferred.facts);
    const explicitMode = normalizeMode(flags.mode);
    if (explicitMode) {
      const modeFact = facts.find((fact) => fact.id === 'delivery.mode');
      modeFact.value = explicitMode;
      modeFact.status = 'confirmed';
      modeFact.source = '--mode flag';
    }
    await writeJsonAtomic(abs, { version: 1, generatedAt: new Date().toISOString(), facts });
    created = true;
  } else if (flags.mode) {
    const explicitMode = normalizeMode(flags.mode);
    if (explicitMode) {
      facts = facts.map((fact) => fact.id === 'delivery.mode'
        ? { ...fact, value: explicitMode, status: 'confirmed', source: '--mode flag' }
        : fact);
      await writeJsonAtomic(abs, { version: 1, generatedAt: new Date().toISOString(), facts });
    }
  }

  const questions = questionsFor(facts);
  const summary = factSummary(facts);
  const mode = deliveryModeFromFacts(facts, flags.mode ? normalizeMode(flags.mode) : null);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      file: config.factsFile,
      created,
      deliveryMode: mode,
      summary,
      questions,
      facts,
    }, null, 2)}\n`);
  } else {
    const c = colorize(colorEnabled(flags));
    process.stdout.write(`${c.bold('slag brief')} ${c.dim(config.factsFile ?? 'slag.facts.json')}\n`);
    if (created) process.stdout.write(c.dim('Created facts template.\n'));
    process.stdout.write(`${summary.requiredConfirmed}/${summary.requiredTotal} required facts confirmed · delivery mode: ${mode ?? c.yellow('unconfirmed')}\n\n`);
    if (questions.length === 0) {
      process.stdout.write(c.green('All facts are confirmed. Build against them.\n'));
    } else {
      const required = questions.filter((question) => question.required);
      const optional = questions.filter((question) => !question.required);
      if (required.length > 0) {
        process.stdout.write(c.yellow(`${c.bold('Ask the user these required questions before writing code:')}\n`));
        required.forEach((question, index) => {
          process.stdout.write(`  ${index + 1}. ${c.bold(question.id)} ${c.dim(`[${question.status}]`)}\n     ${question.question}\n`);
        });
        process.stdout.write('\n');
      }
      if (optional.length > 0) {
        process.stdout.write(c.dim(`Optional open questions: ${optional.map((question) => question.id).join(', ')}\n`));
      }
      process.stdout.write(c.dim(`Record answers in ${config.factsFile ?? 'slag.facts.json'} and set status to "confirmed".\n`));
    }
  }

  if (flags.check && summary.requiredUnconfirmed.length > 0) return 1;
  return 0;
}

export async function runFacts({ flags }) {
  const { loaded } = await loadProject(flags);
  const loadedFacts = await loadFacts(loaded.root, loaded.config);
  const summary = factSummary(loadedFacts.facts);
  const mode = deliveryModeFromFacts(loadedFacts.facts);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({
      file: loadedFacts.file,
      missing: loadedFacts.missing,
      deliveryMode: mode,
      summary,
      facts: loadedFacts.facts,
    }, null, 2)}\n`);
  } else {
    const c = colorize(colorEnabled(flags));
    process.stdout.write(`${c.bold('slag facts')} ${c.dim(loadedFacts.file ?? '(disabled)')}\n`);
    if (loadedFacts.missing) {
      process.stdout.write(c.red('Facts file is missing. Run `slag brief`.\n'));
    }
    process.stdout.write(`${summary.requiredConfirmed}/${summary.requiredTotal} required confirmed · mode ${mode ?? c.yellow('unconfirmed')}\n\n`);
    const rows = loadedFacts.facts.map((fact) => [
      fact.required ? '*' : ' ',
      fact.id,
      fact.status,
      formatValue(fact.value),
      fact.source ?? '',
    ]);
    const widths = [1, 22, 9, 42, 24];
    process.stdout.write(`${'  '.padEnd(2)}${'fact'.padEnd(widths[1])} ${'status'.padEnd(widths[2])} ${'value'.padEnd(widths[3])} source\n`);
    for (const row of rows) {
      const color = row[2] === 'confirmed' ? c.green : row[2] === 'assumed' ? c.yellow : c.red;
      process.stdout.write(`${row[0]} ${row[1].padEnd(widths[1])} ${color(row[2].padEnd(widths[2]))} ${row[3].padEnd(widths[3]).slice(0, widths[3])} ${c.dim(row[4])}\n`);
    }
    process.stdout.write(c.dim('\n* required. Run `slag brief` to list open questions.\n'));
    void listFlag;
  }
  return 0;
}

function mergeFacts(existing, incoming) {
  const byId = new Map(existing.map((fact) => [fact.id, fact]));
  for (const fact of incoming) {
    const current = byId.get(fact.id);
    if (!current) {
      byId.set(fact.id, fact);
      continue;
    }
    if (current.status === 'confirmed') continue;
    byId.set(fact.id, fact);
  }
  for (const fact of buildDefaultFacts()) {
    if (!byId.has(fact.id)) byId.set(fact.id, fact);
  }
  return [...byId.values()];
}

function formatValue(value) {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join(', ');
  return String(value);
}
