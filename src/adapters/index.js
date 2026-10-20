import fs from 'node:fs/promises';
import path from 'node:path';

export const BEGIN = '<!-- slag:begin -->';
export const END = '<!-- slag:end -->';
const BLOCK = new RegExp(`\\n?${escapeForRegex(BEGIN)}[\\s\\S]*?${escapeForRegex(END)}\\n?`, 'm');

export const ADAPTERS = {
  agents: {
    label: 'AGENTS.md (opencode, Codex, generic)',
    files: [{ path: 'AGENTS.md', mode: 'shared' }],
  },
  opencode: {
    label: 'opencode commands',
    files: [
      { path: '.opencode/commands/slag-brief.md', mode: 'dedicated', render: opencodeBrief },
      { path: '.opencode/commands/slag-audit.md', mode: 'dedicated', render: opencodeAudit },
      { path: '.opencode/commands/slag-verify.md', mode: 'dedicated', render: opencodeVerify },
      { path: '.opencode/commands/slag-gate.md', mode: 'dedicated', render: opencodeGate },
    ],
  },
  claude: {
    label: 'Claude Code (CLAUDE.md)',
    files: [{ path: 'CLAUDE.md', mode: 'shared' }],
  },
  cursor: {
    label: 'Cursor rule',
    files: [{ path: '.cursor/rules/slagtech.mdc', mode: 'dedicated', frontmatter: '---\ndescription: Slag anti-slop and facts guardrail\nglobs: ["**/*"]\nalwaysApply: true\n---\n' }],
  },
  copilot: {
    label: 'GitHub Copilot instructions',
    files: [{ path: '.github/copilot-instructions.md', mode: 'shared' }],
  },
  windsurf: {
    label: 'Windsurf rule',
    files: [{ path: '.windsurf/rules/slagtech.md', mode: 'dedicated', frontmatter: '---\ntrigger: always_on\n---\n' }],
  },
  gemini: {
    label: 'Gemini CLI (GEMINI.md)',
    files: [{ path: 'GEMINI.md', mode: 'shared' }],
  },
  aider: {
    label: 'Aider (CONVENTIONS.md)',
    files: [{ path: 'CONVENTIONS.md', mode: 'shared' }],
  },
  cline: {
    label: 'Cline rule',
    files: [{ path: '.clinerules/slagtech.md', mode: 'dedicated' }],
  },
  roo: {
    label: 'Roo Code rule',
    files: [{ path: '.roo/rules/slagtech.md', mode: 'dedicated' }],
  },
  continue: {
    label: 'Continue rule',
    files: [{ path: '.continue/rules/slagtech.md', mode: 'dedicated', frontmatter: '---\nname: Slag guardrail\ndescription: Anti-slop, facts-first rules for this project\nalwaysApply: true\n---\n' }],
  },
  zed: {
    label: 'Zed rules (.rules)',
    files: [{ path: '.rules', mode: 'shared' }],
  },
};

export const ALL_TOOL_IDS = Object.keys(ADAPTERS);

export async function installAdapters(root, ids = ALL_TOOL_IDS, options = {}) {
  const requested = ids.includes('all') ? ALL_TOOL_IDS : ids;
  const written = [];
  const skipped = [];
  const warnings = [];
  for (const id of requested) {
    const adapter = ADAPTERS[id];
    if (!adapter) {
      warnings.push(`Unknown tool adapter "${id}".`);
      continue;
    }
    for (const file of adapter.files) {
      const abs = path.join(root, file.path);
      let content;
      try {
        content = file.render ? file.render(options.project ?? {}, options) : renderCoreSection(options.project ?? {});
      } catch (error) {
        warnings.push(`Adapter ${id} failed: ${error.message}`);
        continue;
      }
      const result = await writeAdapterFile(abs, content, file, options);
      if (result === 'written') written.push(file.path);
      else if (result === 'skipped') skipped.push(file.path);
    }
  }
  return { written, skipped, warnings };
}

async function writeAdapterFile(abs, content, file, options) {
  let existing = null;
  try {
    existing = await fs.readFile(abs, 'utf8');
  } catch {
    existing = null;
  }

  const block = `${BEGIN}\n${content.trim()}\n${END}`;
  const createContent = file.frontmatter ? `${file.frontmatter}\n${block}\n` : `${block}\n`;
  if (existing != null) {
    if (BLOCK.test(existing)) {
      const next = existing.replace(BLOCK, `\n${block}\n`);
      if (next !== existing) await fs.writeFile(abs, next, 'utf8');
      return 'written';
    }
    if (file.mode === 'shared') {
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      await fs.writeFile(abs, `${existing}${separator}${block}\n`, 'utf8');
      return 'written';
    }
    if (!options.force) return 'skipped';
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, createContent, 'utf8');
  return 'written';
}

export function renderCoreSection(project = {}) {
  const commands = project.commands ?? {};
  const commandLines = Object.entries(commands)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([name, value]) => `- ${name}: \`${value}\``)
    .join('\n');
  return `# Slag guardrail

This project uses Slag. The goal is working production behavior, not a polished mockup.
Treat \`slag.facts.json\` as the source of truth for what is being built.

## Facts before code (required)

1. Read \`slag.facts.json\` and \`slag.config.json\`.
2. If a required fact is **unknown** or **assumed**, STOP. Ask the user the open questions in one batch.
3. Never choose the stack, database, auth model, payment provider, deployment target or scope on the user's behalf.
4. Record answers in \`slag.facts.json\`, set \`status: "confirmed"\`, and cite the source. Do not mark a fact confirmed without a user answer.
5. If the user delegates a choice ("you decide"), record the chosen value and the source as "user delegated".

Open questions are listed by:

\`\`\`
npx slag brief
\`\`\`

## Definition of done

Do not say a task is done because the UI renders. A task is done only when:

- Each core action works end-to-end: UI -> handler -> persistence -> reload.
- Every button, link and form has a real destination or behavior.
- Error, loading and empty states exist for real data paths.
- \`npx slag verify\` passes.
- \`npx slag gate\` passes with fresh evidence.
- README claims match the implementation.

${commandLines ? `## Project commands\n\n${commandLines}\n` : ''}
## Non-negotiable rules

- No placeholder copy, lorem ipsum, "coming soon" features or starter screens in a production build.
- No mock/sample/fake data wired into product code. Seed scripts are fine only when the facts allow them.
- No dead \`href="#"\` links, inert buttons, or forms with no action.
- No invented imports, packages, files, env vars, API endpoints or routes. Verify each one exists.
- No fake auth: no localStorage tokens, client-side auth flags, or literal password comparisons.
- No claiming features in the README that are not implemented and tested.
- No TODO/FIXME as a substitute for implementation unless the user explicitly accepts it as follow-up.
- No silent error swallowing. Handle failures visibly.
- Do not return a visual mockup when the user asked for production-ready software.

## Workflow

1. Resolve facts with the user. Do not scaffold around unknowns.
2. Build one vertical slice at a time: schema/model -> server handler -> UI -> test.
3. Wire every control to the slice. Remove visual-only controls instead of leaving them dead.
4. Add tests for the core actions and error paths.
5. Run \`npx slag verify\`, fix every failure, then run \`npx slag gate\`.
6. Only then update the README or claim completion.

## Anti-hallucination

- Check \`package.json\` before importing a package.
- Check that local files and routes exist before referencing them.
- Check API contracts and docs instead of inventing methods or parameters.
- If a fact or API is uncertain, say so and ask. Guessing is not progress.
- Treat \`slag audit\` findings and command output as evidence. Your confidence is not evidence.

## Suppressing a finding

Suppress only with a reason on the same line:

\`\`\`js
// slag-disable-next-line rule-id -- reason this is intentional
\`\`\`

Never suppress security, fake-auth, phantom-import or fact-drift findings. Fix them.

Generated by \`slagtech-agent-control\`. Edits inside the slag block are overwritten; edit \`slag.config.json\` or \`slag.facts.json\` instead.`;
}

function opencodeBrief() {
  return `---
description: Resolve project facts with the user before writing code
agent: plan
---
Run \`npx slag brief\` and read \`slag.facts.json\`.

Ask the user every open question in one batch, grouped by decision: delivery mode, core actions, stack, data model, auth, payments/integrations, deployment and acceptance criteria.

Rules:
- Do not write or change application code until every required fact is confirmed.
- Do not infer versions, providers or scope from the existing scaffold.
- Update \`slag.facts.json\` with the user's answers, mark each answered fact \`confirmed\`, and record the source.
- If the user delegates a choice, record the chosen value and say it was delegated.
- Report which facts remain open and stop.`;
}

function opencodeAudit() {
  return `---
description: Run the anti-slop audit and fix every error
agent: build
---
Run \`npx slag audit --json\`.

Work through findings by severity. For each error:
1. Open the referenced file and confirm the finding.
2. Fix the behavior or remove the surface. Do not weaken the rule.
3. Re-run the audit.

Do not suppress findings except with a same-line reason. Do not claim completion while errors remain.`;
}

function opencodeVerify() {
  return `---
description: Run real verification commands and fix failures
agent: build
---
Run \`npx slag verify\`. It runs the anti-slop audit plus the project's build, typecheck, lint, test and e2e commands, then records evidence in \`.slag/evidence.json\`.

Fix every failure at its source. Do not edit the evidence file, disable tests, or loosen type checks to make the command pass. When it passes, run \`npx slag gate\`.`;
}

function opencodeGate() {
  return `---
description: Enforce the evidence gate before claiming done
agent: build
---
Run \`npx slag gate\`.

The gate fails if:
- the audit has errors,
- required facts are unconfirmed,
- verification evidence is missing or stale,
- any verification command failed,
- a required capability has no evidence.

Do not report the task complete until this command exits 0. If it fails, fix the cause, re-run \`npx slag verify\`, then re-run this gate.`;
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
