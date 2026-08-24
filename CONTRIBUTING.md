# Contributing to Inbase

Issues and pull requests are welcome. This repository is a workspace: the
published CLI lives at the root, the 3D map is `apps/explorer`, and
`apps/example-target` is the bundled demo project.

## Setup

Node.js 20 or newer is required.

```bash
npm install
npm test
npm run dev
```

`npm run dev` maps `apps/example-target` by default. To map another project:

```bash
VISUAL_CODER_TARGET=/path/to/your/project npm run dev
```

To run the example React app itself:

```bash
npm run dev:target
```

## Pull requests

- Keep the change focused. Prefer one concern per PR.
- Run `npm test` before you open the PR.
- Do not commit `.inbase/`, session data, or `*.tgz` packs.
- Match the style of nearby code. No drive-by refactors or formatting-only diffs.

The Cursor skill in `skill/inbase/` is what `inbase init` copies into other
repos. If you change that loop, keep `skill/inbase/SKILL.md` and the CLI
session commands in sync.
