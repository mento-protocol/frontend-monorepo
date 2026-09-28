# Joining this project

For a person joining frontend-monorepo with their own machine and their own agents. Read this, then
`AGENTS.md`, then run `skein status`.

## 1. Your machine

- The agent CLIs you use: Claude Code, and Codex if you run cross-model reviews.
- `gh`, authenticated as yourself.
- Superset with this repo added as a project, if you use the Superset driver. Without it,
  set `"driver": {"type": "local"}` in your copy of the config or export `SKEIN_DRIVER=local`.
- The skein kit, for the skills and `skein init`/`upgrade`:
  ```bash
  git clone https://github.com/bayological/skein ~/.claude/skills/skein && ~/.claude/skills/skein/setup
  ```
  Day to day you need only the vendored copy in this repo: `scripts/skein/skein`.
- Your caps: `~/.skein/config.json` with `{"maxAgents": 3}` (or whatever your machine and
  seat can carry).

Then:

```bash
git clone <this repo> && cd <repo>
git config core.hooksPath scripts/githooks
pnpm install --frozen-lockfile --prefer-offline
pnpm check-types
pnpm exec turbo run test
pnpm exec eslint apps/app.mento.org packages/web3 packages/ui
pnpm knip
git diff --name-only --diff-filter=ACMR origin/audit-main-app...HEAD | grep -E '\.(ts|tsx|mjs|js|json|md|css|ya?ml)$' | grep -v '^scripts/skein/' | xargs -r pnpm exec prettier --check
skein doctor
```

## 2. How work is organised

- **`docs/plan/wps.json`** is the map: each task's `owned` globs are the only files it may change. Two
  tasks never own one file at the same time.
- **`docs/plan/briefs/<task-id>.md`** is a task's specification: what to build, what to read first,
  how it will be judged.
- **The board** (none) is where claims live. Assign yourself before you dispatch or brief.
- **`docs/plan/COORDINATOR.md`** is the runbook for whoever is coordinating.
- **The gate** is `skein gate <task-id>`. CI runs the same script.

## 3. Your own coordinator

Paste `docs/plan/COORDINATOR-PROMPT.md` into a fresh session in your checkout. It spins up
agents, verifies them, reviews, merges, and keeps the record, the same as everyone else's.

## 4. The rules that matter most

- Never commit `.env`; never print a key.
- Never weaken a test to get green.
- Never push to `audit-main-app`; the coordinator merges through `skein merge`.
- Frozen paths (`coordinatorOwned` in the plan) change only through a coordinator PR with an ADR.
  Tasks here come from the 2026-09-28 app.mento.org audit (public issues #1009–#1023). Worker PRs target `audit-main-app`, not `main`.
