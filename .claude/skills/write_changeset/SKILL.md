---
name: write_changeset
description: Create a changeset file documenting changes for the next release.
user-invocable: true
---

# Write Changeset

Create a changeset file in `.changeset/` that documents the change and its semver bump type.

## When to Write a Changeset

Write a changeset for any PR that modifies code affecting the published package. This includes:

- Adding, removing, or modifying exports, types, or utilities
- Fixing bugs in package source code
- Changing protocol buffer definitions, templates, or build configuration
- Updating dependencies that affect runtime behavior

You do NOT need a changeset for:

- Changes to tests only (no source changes)
- Changes to dev tooling, CI, or build config that don't affect published output
- Documentation-only changes
- Changes to `.claude/` configuration

## Publishable Package

| Package name                          | Key directories                                     |
| ------------------------------------- | --------------------------------------------------- |
| `@stripe/stripe-cli-plugin-bootstrap` | `src/`, `scripts/`, `protos/`, `templates/`, `bin/` |

This is a single-package repo. Every changeset references `@stripe/stripe-cli-plugin-bootstrap`.

## Bump Types

- **patch** — Bug fixes, internal refactors with no behavior change, dependency updates
- **minor** — New features, new exports, new options, non-breaking additions
- **major** — Breaking changes. Major bumps require explicit approval.

## Procedure

1. Determine whether the current changes affect the published package (check the directories above)
2. Check if a pending changeset already covers this change — read existing `.changeset/*.md` files (excluding `README.md`). If one already describes the feature or fix being worked on, no new changeset is needed.
3. Determine the appropriate bump type
4. Generate a unique changeset filename using a random identifier (lowercase letters and hyphens, e.g., `happy-dogs-dance`)
5. Create the changeset file at `.changeset/<name>.md`

### Changeset File Format

```markdown
---
'@stripe/stripe-cli-plugin-bootstrap': minor
---

Add setCommandArgs to feed crash reporter and logger from gRPC args
```

The YAML frontmatter lists the package with its bump type. The body is a short, human-readable summary of the change (one or two sentences) written from the user's perspective.

## Examples

### New export

```markdown
---
'@stripe/stripe-cli-plugin-bootstrap': minor
---

Add crash reporter for plugin-level diagnostics
```

### Bug fix

```markdown
---
'@stripe/stripe-cli-plugin-bootstrap': patch
---

Fix crash reporter to use gRPC command args instead of process.argv
```

### Dependency update

```markdown
---
'@stripe/stripe-cli-plugin-bootstrap': patch
---

Upgrade grpc-js to v1.14 for improved connection handling
```

## Notes

- If you are unsure about the bump type, prefer `patch` for fixes and `minor` for new features. When in doubt, ask.
- Each PR should have at most one changeset file. If you need to revise, edit the existing changeset rather than creating a second one.
