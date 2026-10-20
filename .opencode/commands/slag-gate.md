
<!-- slag:begin -->
---
description: Enforce the evidence gate before claiming done
agent: build
---
Run `npx slag gate`.

The gate fails if:
- the audit has errors,
- required facts are unconfirmed,
- verification evidence is missing or stale,
- any verification command failed,
- a required capability has no evidence.

Do not report the task complete until this command exits 0. If it fails, fix the cause, re-run `npx slag verify`, then re-run this gate.
<!-- slag:end -->
