---
title: Vercel-pulled build variables cross into preview candidates only through one-way exact-allowlist materialization
status: active
owner: eng
canonical: true
last_verified: 2026-07-22
scope: ci/deployment/preview-build-environment
date: 2026-07
---

# ADR 0004 — Vercel-pulled build variables cross into preview candidates only through one-way exact-allowlist materialization

**Status:** Accepted (Jul 2026)
**Scope:** ci/deployment/preview-build-environment

## Context

ADR 0001 moved trusted preview compilation to GitHub Actions while retaining
Vercel as the hosting platform. The reusable prebuilt workflow runs `vercel
pull` with a scoped preview token in a runner-owned staging directory, then
builds untrusted pull-request source under a dedicated candidate UID without
the Vercel token.

The first four-target shadow canary exposed a provider-boundary mismatch.
App, Governance, and Reserve pulls included Sensitive variables such as
`SENTRY_AUTH_TOKEN` and, for Governance, `ETHERSCAN_API_KEY`. The workflow
correctly rejected those names before candidate code ran, but the rejection
also prevented valid previews even though the candidate did not need the
pulled copies. Governance already receives its required explorer key from a
separately scoped GitHub secret; previews never need Sentry upload authority.

Passing the raw pulled dotenv file to candidate-owned storage would make a
denylist the security boundary. New provider variables or a missed sensitive
name could then reach arbitrary dependency or build code. Rewriting that file
in place is also unsafe: file replacement, hard links, same-inode temporary
paths, parent-path changes, partial failure, and cleanup races expand a
credential-bearing mutation boundary that is unnecessary for the build.

The repository already has a reviewed per-target variable inventory in
`scripts/vercel-build-environment.mjs`. Requirements explicitly classified as
`vercel-pull` are the ordinary configuration values that a candidate needs.
Sensitive variables are separately classified and scoped. This gives the
workflow a positive policy from which it can derive a minimal candidate input.

This ADR refines ADR 0001's preview credential boundary. It does not supersede
ADR 0001, ADR 0002, or ADR 0003.

## Decision

### Raw pull state is immutable and runner-private

`vercel pull` writes to a fresh, fixed, runner-owned staging root under the
authenticated per-run isolation directory. The raw
`.vercel/.env.preview.local` remains there untouched. It is never renamed,
rewritten, deleted individually, chowned to the candidate, or copied into the
candidate tree.

Before reading, the trusted controller proves the fixed containment path,
runner UID/GID, regular-file type, exact private mode, single link, and bounded
size. It opens the leaf with no-follow semantics, verifies that the opened
descriptor is the same inode that was inspected, reads through that descriptor,
and verifies unchanged metadata. After writing the derived output, it reopens
the source and proves the inode, bytes, size, mode, ownership, and link count
are unchanged.

The candidate UID must have zero processes during materialization and staging.
The raw staging root is `0700`, so candidate code cannot read or replace it.

### Candidate dotenv is a one-way exact allowlist

The trusted controller parses the raw file with the pinned Node.js dotenv
parser and selects only the exact requirements for the chosen target and
environment whose `ciClassification` is `vercel-pull`. Unknown names and every
Sensitive classification are omitted by construction. There is no denylist
fallback and no pass-through bucket.

The selected values are serialized in deterministic name order into a
canonical dotenv representation. Serialization must parse back to the exact
same key/value map before any file is staged. Missing or disallowed empty
requirements, oversized values, control characters, invalid UTF-8, or values
that cannot be represented losslessly fail closed with name-only diagnostics.

The controller creates a fresh runner-owned
`mento-vercel-build-environment` root with `0700` mode and creates its canonical
`.env.preview.local` exactly once with exclusive/no-follow flags and `0600`
mode. A pre-existing root or file is an error; it is never reused or
overwritten. A partial failure stays inside the authenticated run root for the
normal always-run whole-root cleanup rather than triggering path-level unlink
recovery.

### Only derived environment and non-secret mappings cross the boundary

Immediately before staging, the controller recomputes the canonical output
from the protected raw source and compares the exact bytes with the derived
file. It creates fresh candidate `.vercel` directories only while the candidate
UID is stopped and stages exactly:

- the trusted repo-level `repo.json` mapping;
- the pulled non-secret `project.json` mapping; and
- the derived exact-allowlist `.env.preview.local`.

The candidate copy is revalidated for exact shape, ownership, mode, link count,
canonical encoding, and exact target key set. Build validation loads this
candidate copy, overlays audited preview constants, and—for Governance
only—receives `ETHERSCAN_API_KEY` from the existing target-scoped GitHub secret
in the controller validation and candidate process environment. A pulled
`ETHERSCAN_API_KEY` is ignored. `SENTRY_AUTH_TOKEN` never enters a preview
caller or process.

The existing execution boundary remains unchanged: a clean privileged
`env -i` validates provenance and mapping, then candidate execution uses
`env -i`, `setpriv --clear-groups --no-new-privs`, the dedicated UID/GID, the
pinned CLI, and the UID-wide termination/proof boundary. Raw and derived
runner-owned inputs are revalidated after the build and removed during the
trusted handoff or always-run final cleanup only after candidate processes are
proven absent.

### Policy evolution

A new ordinary Vercel variable reaches prebuilt candidates only after it is
added to the target/environment inventory with `ciClassification:
vercel-pull`, documented, and covered by tests. Optional application variables
that are absent from that inventory remain omitted even if Vercel returns them.
Sensitive variables require an explicit GitHub scope and process-level wiring;
changing their classification to `vercel-pull` is not an acceptable shortcut.

## Alternatives considered

### Reject the entire raw file when a Sensitive name appears

Rejected. It is fail-closed but operationally brittle: Vercel may return a
Sensitive name that the candidate does not need, turning a correct credential
boundary into an avoidable preview outage. The canary demonstrated this on
three targets.

### Remove forbidden names from the pulled file in place

Rejected. This keeps security dependent on a denylist and introduces
credential-bearing mutation, rename, hard-link, parent-path, partial-write, and
cleanup races. Proving a safe in-place transition is more complex than never
modifying the source.

### Copy the raw file and delete known Sensitive names in the copy

Rejected. Unknown future names still pass through, and parsing/re-emitting a
mostly arbitrary provider file expands the candidate contract. Exact positive
selection is smaller and auditable.

### Inject every ordinary variable only through process environment

Viable but not selected. It would avoid a candidate dotenv file, but requires
duplicating Vercel CLI dotenv-loading behavior in shell argument construction,
expands the process environment and its size/quoting surface, and makes exact
staged-input inspection harder. A fresh canonical file retains the CLI's normal
input mechanism without retaining raw provider state.

### Give candidate code direct read access to protected staging

Rejected. Read-only access would still expose every pulled value to arbitrary
PR build code and would couple the candidate to raw provider output.

## Consequences

- Pulled Sensitive and unknown variables cannot reach preview candidate code,
  even when Vercel returns them.
- App, Governance, and Reserve previews no longer fail merely because their
  raw pulls contain `SENTRY_AUTH_TOKEN` or `ETHERSCAN_API_KEY`.
- The reviewed inventory becomes an enforcement boundary: forgetting to add a
  required ordinary variable fails closed instead of silently passing it.
- Optional variables not in the inventory no longer affect prebuilt previews.
- Dotenv values have a bounded, lossless representability contract. A value
  outside it needs an explicit reviewed encoding/policy change.
- The workflow owns one additional runner-private directory and must include it
  in exact-path handoff and final-cleanup validation.
- The raw source remains available for post-build revalidation but never for
  candidate inspection; whole-root cleanup retains the existing authenticated
  run identity and fail-closed behavior.

Reconsider this design if Vercel provides a server-side, positively scoped
environment export that can provably return only named non-sensitive values,
or if the CLI gains a first-class exact-variable manifest with equivalent
lossless validation. Do not reconsider merely to accommodate an unknown value;
classify and test that value explicitly.

## Evidence

Repository surfaces:

- [Reusable prebuilt workflow](../../.github/workflows/_vercel-prebuilt.yml)
- [Build-variable inventory and canonical selection](../../scripts/vercel-build-environment.mjs)
- [Protected pull/materialization/staging implementation](../../scripts/vercel-prebuilt-workflow.mjs)
- [Build-environment tests](../../scripts/vercel-build-environment.test.mjs)
- [Filesystem and workflow-boundary tests](../../scripts/vercel-prebuilt-workflow.test.mjs)
- [Workflow structural tests](../../scripts/vercel-prebuilt-workflows.test.mjs)
- [Deployment runbook](../vercel-deployments.md)

Operational evidence:

- Issue [#520](https://github.com/mento-protocol/frontend-monorepo/issues/520)
- Disposable four-target shadow canary
  [#585](https://github.com/mento-protocol/frontend-monorepo/pull/585)

Primary platform and runtime documentation:

- [Vercel CLI `pull`](https://vercel.com/docs/cli/pull)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Node.js environment-variable and dotenv specification](https://nodejs.org/api/environment_variables.html)
- [Node.js `fs.open` flags](https://nodejs.org/api/fs.html#file-system-flags)
