---
description: Run the Jest test suite (optionally filter by pattern)
allowed-tools: Bash, Read
---

Run the project's Jest test suite. Arguments (if provided) are passed through as a filter — they can be a file path, filename fragment, or `-t "<name>"` pattern.

If no arguments are given, run the full suite.

Command to run: `npx jest $ARGUMENTS`

After the run, briefly summarize the result. If any tests fail, list the failing test names and the first assertion error for each — don't dump the full output.
