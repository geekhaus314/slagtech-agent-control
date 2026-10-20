export const contractRules = [
  {
    id: 'capability-evidence',
    category: 'contract',
    impact: 'completeness',
    severity: { relaxed: 'warn', standard: 'error', strict: 'error' },
    description: 'A required capability has no evidence or cannot be verified.',
    hint: 'Point capability.evidence at real implementation and test files, then run `slag verify` so the gate can prove it.',
    run(ctx) {
      for (const capability of ctx.capabilities) {
        if (!capability.required) continue;
        if (capability.evidence.length === 0) {
          ctx.report({
            file: null,
            message: `Capability "${capability.id}" has no evidence files.`,
            data: { capability: capability.id },
          });
        } else if (capability.status === 'unverified') {
          ctx.report({
            severity: 'info',
            file: null,
            message: `Capability "${capability.id}" has evidence files; run \`slag verify\` to prove ${capability.verifiedBy}.`,
            data: { capability: capability.id },
          });
        }
      }
    },
  },
];
