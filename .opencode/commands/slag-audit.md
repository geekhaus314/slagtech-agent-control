
<!-- slag:begin -->
---
description: Run the anti-slop audit and fix every error
agent: build
---
Run `npx slag audit --json`.

Work through findings by severity. For each error:
1. Open the referenced file and confirm the finding.
2. Fix the behavior or remove the surface. Do not weaken the rule.
3. Re-run the audit.

Do not suppress findings except with a same-line reason. Do not claim completion while errors remain.
<!-- slag:end -->
