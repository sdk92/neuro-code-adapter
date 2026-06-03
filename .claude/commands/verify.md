---
description: Run the full pre-commit gauntlet — typecheck + tests + lint
allowed-tools: Bash, Read
---

Run these three checks in parallel and report a combined status:

1. `npx tsc --noEmit`
2. `npx jest`
3. `npx eslint src --ext ts`

Output format:

```
typecheck: PASS / FAIL (N errors)
tests:     PASS / FAIL (N/M passed)
lint:      PASS / FAIL (N warnings, M errors)
```

If anything fails, expand only the failing section with details. If everything passes, that one-block status is the whole response.
