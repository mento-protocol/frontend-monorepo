# Coordinator runbook

For whichever agent is coordinating: a Claude Code session in a main checkout, or a person
by hand. There can be any number of coordinators at once; the board is what keeps them out
of each other's way. A coordinator writes no feature code. It cuts work into path-disjoint
tasks, writes briefs, dispatches workers, verifies every claim with the gate, gets a
cross-model review where money or personal data is involved, merges, and keeps the record
true. **All state is on disk or on the board**; a new coordinator needs only this file, the
plan, the briefs, and `skein status`.

To start a coordinator: open a session in your own checkout and paste
`docs/plan/COORDINATOR-PROMPT.md`.

## The commands

Every step below is a `skein` command, vendored at `scripts/skein/skein` so it is the same on
every machine and in CI:

| Step                                                      | Command                              |
| --------------------------------------------------------- | ------------------------------------ |
| see the DAG, what is ready, what overlaps                 | `skein plan`                         |
| validate or scaffold a brief                              | `skein brief <ID> --check` / `--new` |
| claim, create the workspace, launch the worker            | `skein dispatch <ID>`                |
| wait for the envelope                                     | `skein watch <ID>`                   |
| everything running, board and local, both caps            | `skein status`                       |
| talk to a worker                                          | `skein send <ID> "message"`          |
| the merge gate                                            | `skein gate <ID>`                    |
| cross-model review of the PR                              | `skein review <ID>`                  |
| gate, squash-merge, close the claim, delete the workspace | `skein merge <ID>`                   |

## Cutting work into tasks

A flock only runs several agents at once when several tasks exist whose `owned` globs do not
overlap and whose `deps` are merged. That is the whole trick. When you add a task to
`docs/plan/wps.json`:

- Give it disjoint `owned` globs. `skein plan` prints overlaps among ready tasks.
- Give it `accept` commands the gate can run without anyone's secrets.
- Mark `money: true` or `pii: true` when it touches payments, ledgers, credentials, or personal
  data. Both make a cross-model review mandatory, and `skein merge` refuses without one.
- Anything under `coordinatorOwned` is a coordinator change first (a branch, a short ADR under
  `docs/adr/`, a PR), then a task.

## Claims: N coordinators, one board

The board (none) holds one entry per task, titled `<ID>: <title>`. **Assigning yourself
is the claim**; an unassigned entry is free, an assigned one is someone else's. `skein
dispatch` claims before it creates a workspace and refuses a task someone else holds. `skein
merge` refuses a task you do not hold. State labels (`ready`, `running`, `gating`, `blocked`)
move with the task and read the same in the board UI and in `skein status`.

Two caps bound a dispatch: your machine's (`~/.skein/config.json` `maxAgents`, default 3) and
the repo's (`.skein/config.json` `maxAgents`), counted across all coordinators through the
board. The smaller wins.

Single-writer, always: the files under `coordinatorOwned`. One coordinator changes them at a
time, through a PR the others can see.

## Dispatch

A task is dispatchable when it has a valid brief, its deps are merged, and both the brief and
the plan are on `origin/audit-main-app` (workspaces fork from origin, not from your local branch).

```bash
FM_COORDINATOR=1 git push origin audit-main-app   # briefs and the plan must be on origin
skein dispatch <ID>                         # model from .skein/config.json worker policy
skein watch <ID>
```

For a **resumed or follow-up** round, start the watcher **before** you send the prompt:
envelopes already on screen when it starts are ignored.

## When a worker reports DONE: the merge gate

**A worker's claim is not evidence.** In its worktree:

1. `git diff --name-only origin/audit-main-app...HEAD`: only the task's owned paths.
2. `skein gate --base origin/audit-main-app <ID>`, run by you, must end
   `SKEIN_GATE_RESULT … status=PASS`. Always pass `--base`: the gate otherwise diffs against
   `origin/main` and flags the setup commit on `audit-main-app` as out of bounds.
3. **Read the diff for anything the gate cannot see**: a handler that logs a payload, a query
   that reads-then-writes, a criterion vacuously satisfied. That is what the review is for.
4. **New dependency?** Verify it on the registry and its repository yourself.
5. **`skein review <ID>`** for any `money` or `pii` task: a different model family reviews in a
   read-only worktree and posts one PR comment. Triage each finding on its merits, post rulings
   on the PR, resume the author for fixes (`skein send`), then gate again.
6. **Hand off to the owner; do not merge.** Gate again, confirm the PR targets
   `audit-main-app` and is ready for review (AGENTS.md forbids drafts here), and tell the
   owner. The owner squash-merges it into `audit-main-app`. Then set `done: true` in the
   plan, push it, and delete the workspace. Never run `skein merge` in this repo.
7. After a wave, in your checkout: pull, reinstall, restart anything you run locally.

**Never merge without a human reading the diff** when a task touches production credentials,
live money, or infrastructure the team shares. Those are owner checkpoints whoever coordinates.

## Naming

| What                         | Shape                                    | Example                                        |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Branch                       | `<type>/<slug>-<task-id>`                | `fix/api-json-404-fm-01`                       |
| Workspace                    | `<type>: <slug in words> (<TASK-ID>)`    | `fix: api json 404 (FM-01)`                    |
| PR title                     | `<type>(<scope>): <summary> (<TASK-ID>)` | `fix(api): JSON 404 for unknown paths (FM-01)` |
| Brief, gate, envelope, board | the task id, unchanged                   | `FM-01`                                        |

`skein dispatch` derives the branch and workspace name from the task's `type` and `slug`; the
gate's `--from-branch` resolves the task from the branch; `skein plan` reads the PR title on
`audit-main-app` to know a task merged.

## Pushing to audit-main-app

`scripts/githooks/pre-push` refuses a push to `audit-main-app` unless `FM_COORDINATOR=1` is set.
Branch protection with the gate as a required check is the real guard where the plan allows
it; the hook stops the accident, not the decision.

## Contract changes

Only a coordinator changes `coordinatorOwned` paths: a branch, a short ADR under `docs/adr/`,
the change, a PR the other coordinators can see, merge, then tell running workers to rebase.

## Talking to workers

`skein send <ID> "one line"`. After a usage-limit stall, send `continue`. To pause a worker:
tell it to make a WIP commit and end its turn.

## Hygiene, learned the expensive way

- **Workspaces fork from origin.** An unpushed brief, gate or lifecycle change is absent in the
  worktree. `skein dispatch` refuses if the brief or plan differs from origin.
- **Nobody polls GitHub.** The local gate is the evidence; look at CI once per PR.
- **Never `pkill -f <agent>`**: it kills other coordinators' workers and your own dev server.
  The lifecycle scripts scope by working directory or process group.
- Two tasks must never own the same file at once. Three tasks in one directory cost three
  merge rounds.
- Chain shell steps with `&&` when a later step must not run after a failure.
- **Base branch is `audit-main-app`, and the owner merges.** Stop at gated, reviewed draft PRs: mark them ready for review, never run `skein merge`. After the owner merges a PR into `audit-main-app`, set that task's `done: true` in `docs/plan/wps.json` and push (`FM_COORDINATOR=1 git push origin HEAD:audit-main-app`). The vendored `plan.mjs` only recognises merges on `origin/main`, so without this, dependent tasks never become dispatchable.
- **Push the plan before dispatching.** `skein dispatch` refuses unless the brief and `wps.json` are identical on `origin/audit-main-app`, because workspaces fork from origin.
- **`main` is ruleset-protected and deploys to production on every merge.** The audit branch reaches `main` only through one reviewed PR once the wave is done. Never retarget a worker PR to `main`.
- **Sensitive tasks (brief says `Sensitive: yes`).** The repo is public. Workers open PRs ready for review, so read the PR as soon as it appears: title, body, commit messages, code comments and test names. They must describe what the code now does, never how the previous behaviour could be abused, and must not reference the private audit write-up. Ask the author to reword anything that does (`skein send`).
- **Never run `skein review` on a sensitive task.** It posts the reviewer's findings as a public PR comment (`review.sh`), and a second model will happily explain the exploit. Run the cross-model review locally instead (for example `codex exec` on `git diff origin/audit-main-app...HEAD` in a read-only worktree), keep the output out of the repo, and give the author only neutral fix instructions.
- **Hooks are per worktree.** `extensions.worktreeConfig` is on: skein worktrees set `core.hooksPath scripts/githooks` with `--worktree`, and every other checkout keeps Trunk's hooks. If `skein doctor` reports the hooks path unset in a workspace, run `git config --worktree core.hooksPath scripts/githooks` there.
- **CI runs on PRs into `audit-main-app`.** `ci.yml` and `e2e.yml` have no branch filter. Trunk (with its pinned prettier 3.7.4) and the fork E2E suites run there, not in the local gate. Read their result once per PR.
