
<!-- slag:begin -->
---
description: Run real verification commands and fix failures
agent: build
---
Run `npx slag verify`. It runs the anti-slop audit plus the project's build, typecheck, lint, test and e2e commands, then records evidence in `.slag/evidence.json`.

Fix every failure at its source. Do not edit the evidence file, disable tests, or loosen type checks to make the command pass. When it passes, run `npx slag gate`.
<!-- slag:end -->
