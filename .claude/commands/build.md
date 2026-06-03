---
description: Build the VS Code extension bundle via esbuild
allowed-tools: Bash, Read
---

Build the extension. If `--production` is in $ARGUMENTS, run the production build; otherwise the dev build.

- Dev:        `node esbuild.js`
- Production: `node esbuild.js --production`

After the build, report:
- Whether `dist/extension.js` was written
- The bundle size
- Any warnings esbuild emitted

Do not run the type-checker as part of this command — that's `/typecheck`.
