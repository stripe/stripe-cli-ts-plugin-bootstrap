# Changesets

This repo uses [changesets](https://github.com/changesets/changesets) for versioning and changelogs.

## When to add a changeset

Add a changeset for any PR that changes **publishable code** — source files in `src/`, `scripts/`, config files, or dependencies that affect the built package.

**No changeset needed** for:

- Test-only changes (files in `test/`, `*.test.ts`)
- Documentation changes (`*.md`, `.claude/`)
- CI/workflow changes (`.github/`)
- Dev tooling changes (lint config, prettier config)

## How to add a changeset

```bash
pnpm changeset
```

## Bump types

- **patch** — Bug fixes, internal refactors with no behavior change
- **minor** — New features, new exports, new options
- **major** — Breaking changes (discuss first)

## Format

Each changeset is a markdown file in `.changeset/` with YAML frontmatter:

```markdown
---
'@stripe/stripe-cli-plugin-bootstrap': minor
---

Add `setCommandArgs` to feed crash reporter and logger from gRPC args
```

Write descriptions from the **user's perspective** — what changed, not how.
