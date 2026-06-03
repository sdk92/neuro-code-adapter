---
description: Type-check the project with tsc (no emit)
allowed-tools: Bash, Read
---

Run `npx tsc --noEmit` and report results.

If errors are found:
1. Group them by file
2. For each file, list the line numbers and a one-line description of each error
3. Do not attempt to fix anything unless the user asks

If clean, just say "Type check passed — 0 errors."
