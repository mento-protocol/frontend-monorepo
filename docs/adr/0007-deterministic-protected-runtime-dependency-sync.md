---
title: Protected runtime dependency rotations use deterministic typed repair operations
status: active
owner: eng
canonical: true
last_verified: 2026-08-14
scope: ci/dependabot-protected-runtime-sync
date: 2026-08-14
---

# ADR 0007 — Protected runtime dependency rotations use deterministic typed repair operations

**Status:** Accepted
**Scope:** ci/dependabot-protected-runtime-sync

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

## Decision

The Dependabot controller supports a typed
`dependabot-protected-runtime-sync:v1` repair operation inside the existing
Repair protocol from ADR 0006. The first operation kind is
`vercel-cli-runtime-sync`.

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

An automated reviewer can report the incomplete runtime synchronization before
the typed repair runs. The processor admits that feedback only when every
actionable thread is an exact structured Cursor `Incomplete Vercel CLI runtime
sync` finding. The finding must bind the operation's source and target versions,
root `package.json` path, and trusted seed or current review commit. The v3
packet binds its comment, commit, and body digest. Any different or additional
feedback remains manual. Finalize can reply and resolve the accepted thread only
after the typed Repair receipt, complete green gates, and clean exact-head
re-review.

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

An independent no-secret validation job regenerates the result and requires
exact plan equality. The existing unreachable App commit, Repair Intent,
non-force ref move, completed Repair receipt, post-move recovery, prepared-head
intake, clean re-review, gate recollection, processor approval, and ALL CLEAR
contracts remain unchanged. The Prepare App keeps only its existing
repository-scoped Contents and Pull requests permissions. The processor never
merges or enables native auto-merge; a maintainer still performs the final
squash merge.

Pull-request preview workers validate the candidate contract, manifests, and
locks only as an internally consistent data tuple. Credentialed preview builds
keep using the protected CLI staged from trusted default-branch controller
source. After trusted plan validation, a fresh terminal no-output job binds the
exact validated plan, performs a secretless frozen install, and executes the
candidate CLI's `--version` smoke. It can veto staging but emits no downstream
authority. The exact-main controller adopts that CLI only after the reviewed
change merges.

The stable runtime verifier reads rotating values from
`scripts/vercel-cli-runtime/contract.json`. Routine rotations therefore change
data, manifests, and locks without editing deployment-controller code,
workflows, tests, or runbooks. Dependabot isolates future `vercel` patch/minor
and security updates from the broad tooling group.

Any schema, metadata, registry, generation, byte, path, lineage, identity,
signature, gate, feedback, or repair-budget mismatch fails closed. Major and
prerelease Vercel updates, builder dependency key-set changes, override changes,
and changes that require executable deployment-policy edits remain manual.

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

### Copy the prior Dependabot lockfile bytes into the refreshed head

Rejected. The base can advance between the Dependabot seed and repair. Trusted
generation preserves current-base workspace changes and every non-Vercel root
lock byte from exact current-head inputs.

## Consequences

- Patch and minor Vercel CLI updates can reach ALL CLEAR with the requested
  version intact while human merge remains mandatory.
- The processor gains a versioned adapter interface that can support another
  protected tool only through a separately reviewed operation kind and exact
  allowlist.
- Public npm availability and deterministic pnpm output become planning inputs;
  outages or output drift stop preparation instead of falling back to a model or
  stale bytes.
- The npm open-pull-request limit rises from five to six so the isolated Vercel
  CLI group can open under the five-PR pressure observed during rollout.
- The fixed two-Repair limit remains. Mixed generic and typed repair lineage is
  covered by the historical PR #753 fixtures; a new isolated Vercel PR can use
  the typed runtime sync as its first repair.
- The runtime contract JSON becomes reviewed authority data. Stable executable
  validators still enforce its exact schema, hashes, version agreement, and
  lockfile structure.

## Evidence

- `pnpm dependabot:process:test`
- `node --test scripts/dependabot-protected-runtime-sync.test.mjs`
- `pnpm vercel:versions:check`
- `pnpm vercel:workflow:test`
- `pnpm vercel:production-shadow:test`
- `pnpm supply-chain:lockfile-lint`
- Isolated Vercel live canary: a verified typed Repair must retain Vercel 56.5.0
  in the root and standalone runtime before exact-head ALL CLEAR.
