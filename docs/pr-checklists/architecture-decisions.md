---
title: Architecture Decision Records — when and how
status: active
owner: eng
canonical: true
last_verified: 2026-07-15
---

# Architecture Decision Records — when and how

Architectural decisions are recorded under [`docs/adr/`](../adr/README.md).
Use this checklist when a pull request changes a long-lived system boundary,
workflow, workspace, or engineering policy.

## Does this change need an ADR?

Write an ADR when all three statements are true:

1. **It constrains future work.** A later implementation could do the opposite
   and be wrong without realizing a direction had already been chosen.
2. **There was a real alternative.** The team selected one plausible path over
   another.
3. **The rationale is not obvious from the code.** The diff shows what changed,
   but not why this design should remain.

Add the ADR in the same pull request as the decision. Routine fixes, dependency
bumps, one-off features, and refactors that do not change direction are not
ADRs. A focused code comment is enough when it captures the full rationale at
the only relevant call site.

## Trigger surfaces

`pnpm adr:check` examines files newly added relative to `origin/main` and emits
an advisory reminder when it finds either of these without a new numbered ADR:

- a GitHub Actions workflow at `.github/workflows/*.yml` or `*.yaml`;
- a top-level app or package manifest at `apps/*/package.json` or
  `packages/*/package.json`.

The deliberately narrow trigger set favors signal over exhaustive detection.
Changes can still need an ADR even when the reminder stays quiet: replacing a
hosting platform, changing preview or promotion semantics, changing a trust
boundary, selecting a shared state model, or introducing a repository-wide
policy are common examples.

The default check is quiet unless it has a reminder and always exits zero. Use
strict mode only when an explicit hard gate is appropriate:

```bash
pnpm adr:check
pnpm adr:check --strict
pnpm adr:check --base <base-sha> --head <head-sha> --strict
```

Use `--include-untracked` during local drafting if the trigger file or ADR has
not been staged. The Trunk pre-push action runs advisory mode; CI does not force
strict mode.

## How to write one

1. Use the next free four-digit number and a kebab-case filename:
   `docs/adr/NNNN-short-title.md`.
2. Include frontmatter with `status: active`, `owner: eng`, `canonical: true`,
   `last_verified: <today>`, `scope`, and `date`. Put **Accepted** in the body,
   not in the frontmatter `status` field.
3. Include the core sections **Status**, **Context**, **Decision**,
   **Alternatives considered**, **Consequences**, and **Evidence**.
4. Describe ownership and trust boundaries, failure behavior, rollback, and
   measurable reconsideration criteria when they apply.
5. Cite public issues, merged pull requests, canonical files, and primary
   documentation. Do not copy credentials, private billing values, or other
   operational secrets into an ADR.
6. Add the ADR to [`docs/adr/README.md`](../adr/README.md) and confirm the root
   `AGENTS.md` pointer remains accurate.

## When the reminder is not applicable

A trigger file can be mechanically new without introducing a new direction.
In that case, leave the ADR out and answer the pull-request template's
**Architecture decision?** prompt with `Not applicable — <technical reason>`.
The reminder is intended to force a conscious answer, not manufacture records.
