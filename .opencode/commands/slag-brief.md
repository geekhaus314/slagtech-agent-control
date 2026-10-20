
<!-- slag:begin -->
---
description: Resolve project facts with the user before writing code
agent: plan
---
Run `npx slag brief` and read `slag.facts.json`.

Ask the user every open question in one batch, grouped by decision: delivery mode, core actions, stack, data model, auth, payments/integrations, deployment and acceptance criteria.

Rules:
- Do not write or change application code until every required fact is confirmed.
- Do not infer versions, providers or scope from the existing scaffold.
- Update `slag.facts.json` with the user's answers, mark each answered fact `confirmed`, and record the source.
- If the user delegates a choice, record the chosen value and say it was delegated.
- Report which facts remain open and stop.
<!-- slag:end -->
