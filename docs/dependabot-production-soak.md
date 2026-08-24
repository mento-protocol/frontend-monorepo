# Dependabot production soak report

Captured at `2026-08-24T10:08:45Z` for `mento-protocol/frontend-monorepo`.

Recorded production coverage: **3 of 5 cases observed; 2 pending.**

> This offline report is observational. It does not authenticate GitHub evidence or grant preparation, approval, merge, deployment, or recovery authority.

| Case             | State   | Production evidence                                                                                        | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native green npm | PENDING | -                                                                                                          | No native green npm PR has reached ALL CLEAR under the current human-merge controller. Unit fixtures are not production evidence.                                                                                                                                                                                                                                                                                                                      |
| Stale npm        | PASS    | [#777](https://github.com/mento-protocol/frontend-monorepo/pull/777) at `e2d4d4df` (controller `cac852db`) | [ALL CLEAR 96921940188](https://github.com/mento-protocol/frontend-monorepo/runs/96921940188), [main CI 96924945428](https://github.com/mento-protocol/frontend-monorepo/runs/96924945428), and [post-merge 96928591876](https://github.com/mento-protocol/frontend-monorepo/runs/96928591876) passed. Preparation recorded 10 refreshes, 1 repair, and operations `vercel-cli-runtime-sync`. Merge `a970c5f2` finished with `active-committed` proof. |
| Repairable npm   | PASS    | [#723](https://github.com/mento-protocol/frontend-monorepo/pull/723) at `12ef9612` (controller `bb46c3b8`) | [ALL CLEAR 97211160113](https://github.com/mento-protocol/frontend-monorepo/runs/97211160113), [main CI 97211805922](https://github.com/mento-protocol/frontend-monorepo/runs/97211805922), and [post-merge 97214188175](https://github.com/mento-protocol/frontend-monorepo/runs/97214188175) passed. Preparation recorded 1 refresh, 1 repair, and operations `next-catalog-override-sync`. Merge `eab3284f` finished with `active-committed` proof. |
| Routine Actions  | PENDING | -                                                                                                          | No current-controller routine Actions patch or minor PR has reached native ALL CLEAR and exact-main post-merge proof. Older pre-controller merges do not qualify.                                                                                                                                                                                                                                                                                      |
| Manual Actions   | PASS    | [#840](https://github.com/mento-protocol/frontend-monorepo/pull/840) at `c60c9d3c` (controller `9532a5f8`) | [Processor 97363845650](https://github.com/mento-protocol/frontend-monorepo/runs/97363845650) returned `manual-review` for `github-actions-manual` (google/osv-scanner-action/osv-scanner-action, google/osv-scanner-action/osv-reporter-action). The captured head had no processor approval, auto-merge request, ALL CLEAR, Refresh, or Repair authority.                                                                                            |

## Evidence handling

Offline validation checks only the manifest schema, internal consistency, and report rendering. It does not query GitHub or prove that a recorded resource exists, is current, or has the declared publisher and conclusion.

A maintainer must revalidate the exact live GitHub PR, head, controller SHA, checks, workflow runs, approval state, merge, and post-merge result before changing a row from `PENDING` to `PASS`. Keep a case pending until a real Dependabot event supplies that evidence. Contract tests and copied identifiers are not production evidence.

Render or check this observational report without network access:

```bash
node scripts/dependabot-production-soak.mjs
node scripts/dependabot-production-soak.mjs --check docs/dependabot-production-soak.md
```
