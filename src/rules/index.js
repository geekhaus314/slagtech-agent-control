import { contentRules } from './content.js';
import { stubRules } from './stubs.js';
import { wiringRules } from './wiring.js';
import { backendRules } from './backend.js';
import { securityRules } from './security.js';
import { qualityRules } from './quality.js';
import { hallucinationRules } from './hallucination.js';
import { claimRules } from './claims.js';
import { factRules } from './facts.js';
import { contractRules } from './contract.js';

export const RULES = [
  ...factRules,
  ...claimRules,
  ...hallucinationRules,
  ...contentRules,
  ...stubRules,
  ...wiringRules,
  ...backendRules,
  ...securityRules,
  ...qualityRules,
  ...contractRules,
];

const BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function getRule(id) {
  return BY_ID.get(id) ?? null;
}

export function ruleCatalog() {
  return RULES.map((rule) => ({
    id: rule.id,
    category: rule.category,
    impact: rule.impact,
    severity: rule.severity,
    description: rule.description,
    hint: rule.hint,
  }));
}
