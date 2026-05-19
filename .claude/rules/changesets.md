# Rule: Changesets

**Every commit that changes publishable code must be covered by a changeset.**

This repo uses [changesets](https://github.com/changesets/changesets) for versioning and changelogs. When Claude is committing code, it must check whether a changeset is needed and create one if so.

## When a changeset is required

Any change to files that affect the built/published package:

- `src/**` — Package source code
- `scripts/**` — Build, release, and install scripts
- `protos/**` — Protocol buffer definitions shipped with the package
- `templates/**` — Plugin templates shipped with the package
- `bin/**` — CLI entry points
- `tsconfig.json`, `api-extractor.json` — Build configuration
- `package.json` — Dependency changes that affect runtime behavior

## When a changeset is NOT required

- Test files (`**/*.test.ts`, `test/**`)
- Documentation (`*.md`, `docs/**`, except when docs are shipped in the package)
- CI/CD (`.github/**`)
- Claude config (`.claude/**`)
- Dev tooling (`.eslintrc*`, `.prettierrc*`, `vitest.config.*`, `eslint.config.*`)
- Changeset config (`.changeset/**`)

## Workflow

Before committing, follow this sequence:

1. Check if any staged files match the "required" paths above
2. If no required paths are touched, no changeset needed — stop here
3. Check if a pending changeset already covers this change:
   - List existing `.changeset/*.md` files (excluding `README.md`)
   - Read each one — if any describes the same feature or fix being worked on, the existing changeset is sufficient
   - Example: you're pushing a follow-up fix to a feature that already has a changeset saying "Add crash reporter" — no new changeset needed
4. If no existing changeset covers the change, create one using `/write_changeset` or by writing the file directly
5. Stage the changeset file alongside the code changes

## How to create a changeset

Use the `/write_changeset` skill or write the file directly:

```
.changeset/<random-name>.md
---
'@stripe/stripe-cli-plugin-bootstrap': patch
---

Description of the change from the user's perspective
```

## Bump types

- **patch**: Bug fixes, refactors with no behavior change, dependency updates
- **minor**: New features, new exports, new options
- **major**: Breaking changes — never use without explicit discussion
