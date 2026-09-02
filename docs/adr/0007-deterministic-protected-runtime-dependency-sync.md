---
title: Protected runtime dependency rotations use deterministic typed repair operations
status: archived
owner: eng
canonical: false
last_verified: 2026-09-01
scope: ci/dependabot-protected-runtime-sync
date: 2026-08-14
superseded_by: "0009"
---

# ADR 0007 — Protected runtime dependency rotations use deterministic typed repair operations

**Status:** Superseded by ADR 0009 on 2026-09-01
**Scope:** ci/dependabot-protected-runtime-sync

This ADR records the retired typed repair architecture.
[ADR 0009](0009-external-agent-dependabot-preparation.md) makes protected
runtime rotations a maintainer-only manual procedure with existing repository
validators.

> Archive notice: The remainder of this file is historical. Do not run its
> commands or use its operation protocol. Use ADR 0009 and the active maintainer
> rotation procedure.

## Context

Some dependencies appear in both the ordinary workspace and a standalone,
security-hardened runtime used by trusted GitHub Actions code. Updating only the
workspace leaves that runtime's manifest, lockfile, and digest authority stale.
The generic Dependabot repair planner cannot write runtime or deployment-policy
paths because candidate-controlled evidence and model output must not be able to
rewrite the boundary that later handles deployment credentials.

The Vercel CLI is the first concrete case. Dependabot PR #753 requested
`vercel` 56.5.0, while the protected runtime still admitted 56.4.1. The generic
repair path correctly stayed inside its allowlist, but restored the workspace
pin to 56.4.1 to make the existing contract pass. Merging that result would
cause a later Dependabot run to request the same update again.

Routine same-major Vercel CLI releases can still be mechanical. Their exact npm
metadata, workspace manifests, root overrides, standalone manifest, and two
lockfiles provide enough data for trusted code to reproduce and verify the
required bytes without executing candidate code or granting the model broader
write authority.

Next is the second case. Dependabot PR #723 updated the workspace catalog from
16.2.12 to 16.3.1 while the root override stayed at 16.2.12. A generic repair
packet exposed only the files in the PR diff. The model could not edit the
unchanged root override, so it restored the catalog to 16.2.12. The resulting
head passed the version-skew check but no longer contained the requested Next
update. Changing the root override also changes the standalone runtime manifest
and contract because both bind the full override map.

## Decision

The Dependabot controller supports a typed
`dependabot-protected-runtime-sync:v1` repair operation inside the existing
Repair protocol from ADR 0006. The first operation kind is
`vercel-cli-runtime-sync`. The second is `next-catalog-override-sync`.

The processor admits that operation only when immutable Dependabot metadata
contains exactly one stable, monotonic, same-major patch or minor update for
the unscoped `vercel` package. It binds the verified seed, current PR head and
base, target version, exact current-head input blobs, exact pnpm version, and a
fixed five-path output allowlist:

- `package.json`;
- `pnpm-lock.yaml`;
- `scripts/vercel-cli-runtime/contract.json`;
- `scripts/vercel-cli-runtime/package.json`; and
- `scripts/vercel-cli-runtime/pnpm-lock.yaml`.

The operation uses `dependabot-repair-packet:v3`; generic model-authored
repairs keep the exact v2 schema. A v3 operation may exist without a failed
check because realizing the immutable requested target across the protected
runtime is itself the required repair. The processor cannot publish ALL CLEAR
until the current tree reports the requested root and runtime version and its
reachable Repair lineage contains the exact typed operation.

The Next kind admits only one immutable `frontend-core` dependency row for the
unscoped `next` package. It requires a stable, monotonic, same-major patch or
minor update. Every current catalog, root override, and standalone runtime
override spec must equal the exact caret source or target spec. It rejects any
prerelease, major update, downgrade, overshoot, other current range, malformed
runtime contract, or missing proof. It binds the same 15 current-head input
blobs and a fixed six-path output allowlist:

- `package.json`;
- `pnpm-lock.yaml`;
- `pnpm-workspace.yaml`;
- `scripts/vercel-cli-runtime/contract.json`;
- `scripts/vercel-cli-runtime/package.json`; and
- `scripts/vercel-cli-runtime/pnpm-lock.yaml`.

Trusted provider-baseline failures do not delay this deterministic repair. They
remain failed, stay outside the packet, and continue to block ALL CLEAR.

An automated reviewer can report the incomplete synchronization before the
typed repair runs. The processor admits that feedback only when every
actionable thread matches the selected operation. Vercel accepts only an exact
structured Cursor `Incomplete Vercel CLI runtime sync` finding on root
`package.json`. Next accepts only an exact structured Cursor `Next bump never
applied` finding on root `pnpm-lock.yaml`. Each finding must bind the operation's
source and target versions and a review commit from the authenticated prepare
lineage. This includes an authenticated intermediate repair head that remains
in the lineage after a required refresh. A commit outside that lineage remains
manual. The v3
packet binds its comment, commit, and body digest. Any different or additional
feedback remains manual. Finalize can reply and resolve the accepted thread only
after the typed Repair receipt, complete green gates, and clean exact-head
re-review. The bound commit is the REST comment's immutable
`original_commit_id`. The mutable `commit_id` may name that original commit or
the exact packet head after GitHub retargets the comment during a refresh.

The repair workflow routes v3 to trusted, model-free generator code from the
exact default-branch workflow SHA. Planning and validation receive no App,
provider, package, deployment, or write credential. The generator:

1. authenticates the packet and sealed exact-blob evidence;
2. reads the exact root workspace manifests and existing lockfiles as data;
3. fetches only the exact current and requested public npm version metadata;
4. rejects a changed builder dependency key set, non-exact or unsafe dependency
   source, override drift, patched dependency, prerelease, downgrade, or major;
5. changes only the exact Vercel importer, package, peer, and snapshot regions
   of the root lock while preserving every other refreshed-head byte;
6. runs exact pnpm 10.34.4 with lifecycle scripts, workspace links, and
   pnpmfile loading disabled to regenerate the standalone lock twice and
   requires identical bytes; and
7. emits only bounded contextual patches for the fixed five paths.

For the Next kind, the generator moves the catalog and root override to the
immutable target. It treats the sealed current root lock as the output source.
It runs exact pnpm once in an isolated store to solve the immutable target as
an oracle. The typed operation binds `resolutionMode: lowest-direct`, and the
oracle uses `--config.resolution-mode=lowest-direct` so the caret floor resolves
to that target. This setting constrains the oracle. It does not define the
output lock.

The generator imports only the exact target Next runtime closure package and
snapshot records and their integrity values from the oracle. It rewrites the
source declarations and structured runtime references to that closure. It
binds the target package peer dependencies, optional-peer metadata, Node
engine, bin shape, retained snapshot peer references, peer context, and
transitive-peer set to the exact registry metadata and oracle. It preserves
every unrelated source resolution. It rejects an incomplete or unexpected
closure, the source or a later Next runtime version, and any result that fails
a frozen-lock check. It then copies the target root override map into
the standalone runtime manifest, rotates the exact Next override in the sealed
standalone lock, requires that lock to contain no Next package or snapshot, and
rebuilds the contract with the unchanged Vercel version, dependencies, and
registry integrity plus the new manifest, lock, and override digests. Frozen
checks cover both locks. These steps build the fixed six outputs
deterministically. The exact Next operation receives a typed-only per-edit
limit of 48 KiB because its verified 16.2.12 to 16.3.1 lock patch exceeds 8
KiB. Edits for other operation kinds remain capped at 8192 bytes. The aggregate
plan stays capped at 64 KiB.

An independent no-secret validation job regenerates the result and requires
exact plan equality. The existing unreachable App commit, Repair Intent,
non-force ref move, completed Repair receipt, post-move recovery, prepared-head
intake, clean re-review, gate recollection, processor approval, and ALL CLEAR
contracts remain unchanged. The Prepare App installation has repository-scoped
Contents and Pull requests write permissions. Each job requests only its
required subset. Protected-runtime repair tokens request Contents write;
refresh tokens request Contents and Pull requests write. The processor never
merges or enables native auto-merge; a maintainer still performs the final
squash merge.

Pull-request preview workers validate the candidate contract, manifests, and
locks only as an internally consistent data tuple. Credentialed preview builds
keep using the protected CLI staged from trusted default-branch controller
source. After trusted plan validation, a fresh terminal no-output job uses API
and shell steps to materialize the exact trusted scripts, a byte-identical
sealed Node executable, and the hash-verified pnpm bootstrap. It registers no
runner action or post action before candidate code. A separate non-sudo account
runs candidate code and cannot write the trusted source, evidence, Node or pnpm
executable, candidate `PATH` directories, workspace, Actions directory, or
runner command files. The checked `PATH` excludes the runner-owned
`/usr/local/bin` directory. The job binds the exact validated plan, reapplies its patches to
fresh exact packet evidence, and requires every result digest to match. It does
not run another registry oracle. It performs secretless frozen checks. For
Next, its final step performs a cacheless frozen install of only the selected
app's production dependencies. Lifecycle scripts run in a sanitized
environment. The job executes the exact target CLI and builds a minimal App
Router project. It can
veto staging but emits no downstream authority. The exact-main controller
adopts protected runtime changes only after the reviewed change merges.

The Prepare App becomes the sender of the post-move pull-request event. Direct
PR workflows use a positive `ALLOW_REPOSITORY_CREDENTIALS` grant from the
signed event. Only a same-repository `User` PR author and `User` sender can
receive repository credentials. Dependabot, the Prepare App bot, and reserved
Dependabot refs remain secretless. Candidate jobs do not persist checkout
credentials or use dependency, Foundry, or Trunk caches. This applies to CI, E2E,
visual, and Quality Budgets. PR supply-chain scanners have no write token.
Separate scheduled/manual scanners publish SARIF. Because the grant lives in
direct PR workflow code, the Prepare App never mutates a PR generation whose
live diff contains `.github/workflows/**` or `.github/actions/**`. Refresh and
repair mutators re-fetch this exact inventory immediately before a ref write.

The stable runtime verifier reads rotating values from
`scripts/vercel-cli-runtime/contract.json`. Routine rotations therefore change
data, manifests, and locks without editing deployment-controller code,
workflows, tests, or runbooks. Dependabot isolates future `vercel` patch/minor
and security updates from the broad tooling group.

Any schema, metadata, registry, generation, byte, path, lineage, identity,
signature, gate, feedback, or repair-budget mismatch fails closed. Major and
prerelease Vercel updates, builder dependency key-set changes, override changes,
and changes that require executable deployment-policy edits remain manual.

The initial Next rollout required clear feedback. Live PR #723 showed that
Cursor can report the exact typed-operation invariant before the repair runs.
That state deadlocked because the unresolved finding blocked the packet that
would fix it. The Next kind now uses its own exact structured finding exception.
It does not reuse the Vercel finding parser or path. Mixed or inexact feedback
remains manual.

## Alternatives considered

### Broaden the generic repair allowlist

Rejected. Giving a model access to runtime, workflow, or deployment-controller
paths would let untrusted PR evidence influence the code that validates its own
dependency state and later runs near credentials.

### Keep every protected runtime update manual

Rejected for stable same-major Vercel updates. It avoids new automation but
turns reproducible manifest and lockfile synchronization into recurring human
work and permits generic repair to undo the requested update.

### Create a separate mutation workflow and receipt family

Rejected. The existing staged commit, Intent, ref move, receipt, recovery, and
prepared review protocol already provides the required authority and crash
recovery. A parallel mutation protocol would duplicate security-sensitive code.

### Regenerate the complete root lock with pnpm

Rejected. Identical pnpm runs can choose different unrelated transitive peer
bindings. The root lock changed between isolated runs even when every command
and input was identical. This behavior matches
[pnpm issue #13567](https://github.com/pnpm/pnpm/issues/13567). Resolver flags,
isolated stores, and repeated generation did not make full output a safe
determinism proof. The source-preserving transform limits resolver output to
the authenticated Next runtime closure.

### Copy the prior Dependabot lockfile bytes into the refreshed head

Rejected. The base can advance between the Dependabot seed and repair. Trusted
generation preserves current-base workspace changes and every non-Vercel root
lock byte from exact current-head inputs.

## Consequences

- Patch and minor Vercel CLI updates can reach ALL CLEAR with the requested
  version intact while human merge remains mandatory.
- The exact Next catalog/root/runtime skew can reach ALL CLEAR without a model
  choosing the update direction.
- The processor gains a versioned adapter interface that can support another
  protected tool only through a separately reviewed operation kind and exact
  allowlist.
- Public npm availability and the exact pnpm oracle become planning inputs.
  Registry outages, an invalid target closure, frozen-lock failure, or an exact
  plan mismatch stop preparation instead of falling back to a model or stale
  bytes.
- The root output preserves unrelated source resolutions. Full resolver output
  cannot introduce unrelated transitive peer or registry metadata drift.
- The npm open-pull-request limit rises from five to six so the isolated Vercel
  CLI group can open under the five-PR pressure observed during rollout.
- The fixed two-Repair limit remains. Mixed generic and typed repair lineage is
  covered by the historical PR #753 fixtures; a new isolated Vercel PR can use
  the typed runtime sync as its first repair.
- A second generic repair can follow a proven Vercel v3 sync only for exact
  safe finding or feedback paths. The packet authenticates the full PR
  inventory but excludes the protected runtime blobs from its expected and
  permitted edit sets. Missing proof or any other protected path fails closed.
- The runtime contract JSON becomes reviewed authority data. Stable executable
  validators still enforce its exact schema, hashes, version agreement, and
  lockfile structure.

## Evidence

- `pnpm dependabot:process:test`
- `node --test scripts/dependabot-protected-runtime-sync.test.mjs`
- `NEXT_CATALOG_SYNC_INTEGRATION=1 pnpm exec node --test scripts/dependabot-protected-runtime-sync.test.mjs`
- `pnpm vercel:versions:check`
- `pnpm vercel:workflow:test`
- `pnpm vercel:production-shadow:test`
- `pnpm supply-chain:lockfile-lint`
- Isolated Vercel live canary: a verified typed Repair must retain Vercel 56.5.0
  in the root and standalone runtime before exact-head ALL CLEAR.
- Next canary: a verified typed Repair must retain the immutable Next target in
  the catalog, root override, root lock, standalone runtime, and runtime
  contract before exact-head ALL CLEAR.
