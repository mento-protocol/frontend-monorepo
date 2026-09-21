---
title: Shell size limits enforced by a copied checker
status: active
owner: eng
canonical: true
last_verified: 2026-09-21
scope: repository-policy
date: 2026-09-21
---

# ADR 0013 — Shell size limits enforced by a copied checker

## Status

Accepted.

## Context

Shell scripts here grow without a limit, while JavaScript does not: ESLint caps
a function at 50 lines. `scripts/cloud-session-setup.sh` had reached two
functions of 58 and 56 lines, each holding three separate phases.

`mento-protocol/agents` already enforces the same limits on its own scripts
with `scripts/check-shell-size.mjs`. That file reads function boundaries from
the shfmt parser through `mvdan-sh`, so a here document or a `function` keyword
is read the way bash reads it, and it holds no constant of the repository it
runs in. Its test suite lives beside it there.

## Decision

Enforce two limits on every tracked `*.sh` file: at most 500 lines per file and
at most 50 lines per function. Run them through `pnpm check:shell` locally and
in the `static` job of `.github/workflows/ci.yml` on every pull request.

Adopt the checker as a byte-identical copy of the file in
`mento-protocol/agents`, not as a published package and not as a Trunk custom
linter. The source repository stays the single place it is changed: a fix lands
there first and is copied here. `scripts/check-shell-size.test.mjs` is a smoke
test that the copy and its `mvdan-sh` dependency work here, not a second copy of
the source suite.

`scripts/shell-size-baseline.txt` ships with no rows, because the two long
functions are split in the same change. A row would exempt one file or one
function that predates the limits; the ratchet in CI refuses a row the base
branch lacks and a count above the base's, so an allowance can only go down.

The copy cannot carry this repository's inline suppression comments, so the root
`eslint.config.mjs` turns `turbo/no-undeclared-env-vars` off for that one path
and declares the Node `process` global for it. `MAX_FILE_LINES`,
`MAX_FUNCTION_LINES` and `SHELL_SIZE_BASE` are inputs of a check, not of a
Turborepo task, so they are not added to `turbo.json`.

## Alternatives considered

- Publish the checker as an npm package. It would version the tool properly, but
  it costs a release for every fix and a dependency update in every consumer,
  for one file that changes rarely.
- Write a Trunk custom linter. Trunk already runs `shellcheck` and `shfmt`, but a
  custom linter is defined per repository and would drift from the source
  repository's copy with nothing to compare it against.
- Enforce nothing and rely on review. Review has not caught the growth so far,
  and the limit is mechanical.

## Consequences

A script that outgrows a limit is split by topic; it does not get an exemption.
The checker's bytes are never edited here, so a false positive is reported to
`mento-protocol/agents` and the corrected file is copied back. The copy drifts
silently if that step is skipped, which is the accepted cost of not publishing a
package. A shallow CI checkout must fetch the base branch before the check, so
the ratchet has a base to compare with.

## Evidence

- `scripts/check-shell-size.mjs`, `scripts/shell-size-baseline.txt`,
  `scripts/check-shell-size.test.mjs`
- The `Check shell file and function sizes` step in
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- The "Shell scripts" section of [`AGENTS.md`](../../AGENTS.md)
