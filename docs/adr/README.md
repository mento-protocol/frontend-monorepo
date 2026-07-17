---
title: Architecture Decision Records
status: active
owner: eng
canonical: false
---

# Architecture Decision Records

This directory records the architectural **why** for the frontend monorepo.
Each ADR captures a decision that constrains future work, had a real
alternative, and cannot be understood completely from the implementation
alone. Bug fixes, routine dependency updates, and direction-neutral refactors
do not need ADRs.

An ADR is decision context, not proof of current behavior. Verify current code,
configuration, workflow state, and live infrastructure before operating on the
system.

## Lifecycle

Frontmatter `status` is `active` while a decision is in force and `archived`
after it is superseded or retired. The decision lifecycle appears separately
in the body as **Accepted** or **Superseded by ADR NNNN**. In-force decisions
use `canonical: true` and include `last_verified`, `scope`, and `date`.

Do not rewrite history when direction changes. Add a new ADR, set the old ADR
to `status: archived`, and add a `superseded_by:` pointer.

## Adding an ADR

Use the three-part test and writing procedure in
[`docs/pr-checklists/architecture-decisions.md`](../pr-checklists/architecture-decisions.md).
Add the ADR in the same pull request that makes the decision and add it to the
index below. The advisory `pnpm adr:check` command reminds authors when a diff
adds a high-signal surface without a numbered ADR.

## Index

### CI and deployment

| ADR                                                            | Decision                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [0001](0001-github-actions-vercel-deployment-orchestration.md) | GitHub Actions owns Vercel build/deployment orchestration; Vercel remains hosting/runtime |
| [0002](0002-single-comment-preview-controller-journal.md)      | One canonical pull-request comment stores the preview controller journal                  |
| [0003](0003-preview-worker-dispatch-authentication.md)         | A dedicated repository-scoped credential dispatches preview workers                       |
