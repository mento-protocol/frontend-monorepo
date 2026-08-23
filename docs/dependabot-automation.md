---
title: Dependabot Processing
status: active
owner: eng
canonical: true
last_verified: 2026-08-23
scope: ci/dependabot-processing
---

# Dependabot Processing

The Dependabot controller prepares eligible pull requests for one human action:
clicking Merge. It can classify, refresh, repair, re-review, satisfy
receipt-bound feedback, approve through the normal processor identity, and
publish exact-head ALL CLEAR evidence. It never merges and never enables native
auto-merge.

[ADR 0006](adr/0006-dependabot-processing-controller.md) records this decision.
This runbook defines the live trust boundaries, receipts, operating sequence,
and failure handling.

## Invariants

Keep these properties true in code, workflows, rulesets, and operation:

- Modes are exactly `observe`, `assist`, and `prepare`. Missing, empty,
  legacy `merge`, unknown, case, or whitespace variants become `observe`.
- No workflow or controller code calls a merge endpoint, runs `gh pr merge`,
  enables auto-merge, or holds a merge queue entry. A maintainer performs the
  final squash merge.
- Every decision, packet, mutation, review, reply, approval, and readiness
  receipt binds the exact repository, PR, branch, current base, and head.
- Any push invalidates all earlier current-head gates and review evidence.
- Refresh and repair are strict append-only operations within one generation.
  A complete native-to-native Dependabot rewrite chain starts a new generation.
  Any other force-push history permanently removes preparation authority for
  the PR.
- Refreshes have a separate receipt lineage and do not spend the two-repair
  budget. At most two repair commits are allowed.
- Branch-write authority and approval/ALL CLEAR authority never coexist in one
  job or process.
- Candidate input is never executed. The read-only materializer may hold a
  step-scoped token while sealing exact inert Git blobs; candidate artifacts,
  dependencies, caches, and commands never enter a write- or secret-bearing
  job.
- Only one ALL CLEAR candidate occupies the lane. Keep it occupied through the
  human merge and the exact merge SHA's default-branch CI and release proof.
- Keep the npm open-pull-request limit at six or higher. Five npm PRs were
  already open when the isolated Vercel lane launched, so the former limit
  prevented that rotation from reaching the processor.
- Dependabot applies the npm cooldown as pnpm's `minimumReleaseAge` during
  lockfile generation. A young dependency already reviewed and pinned on
  `main` can block an unrelated update. Permit only exact-version exclusions
  that match the current reviewed pin. Remove each exclusion after the release
  matures or when the pin changes.
- Keep the root `zustand>use-sync-external-store` override at `1.4.0` while the
  application and Wormhole wallet paths share Wagmi. This prevents pnpm from
  creating separate `@wagmi/core` peer snapshots for those paths. Upgrade the
  override only after the generated lockfile retains one Wagmi core snapshot.
- ALL CLEAR is current evidence, not a timeless authorization. GitHub must still
  enforce current-base and ruleset state when the maintainer clicks Merge.

## Trust topology

### Native Dependabot intake

`.github/workflows/dependabot-intake.yml` is the credentialless
`pull_request_target` boundary for `opened`, `synchronize`, and
`reopened`. Its existing `dependabot-intake:v1` title stays strict. The
workflow has `permissions: {}`, one local shell step, no API call, no secret,
no checkout, and no artifact. It binds repository, PR, Dependabot-owned
`dependabot/*` ref, exact head, base `main`, action, and the exact Dependabot
bot event sender login, user ID, and type.

Do not relax this receipt to admit an App-authored head. The strict native
receipt is useful because a normal Dependabot synchronize and a prepared
successor have different actors and lineage requirements. App-authored
synchronize events are inert here and enter only through prepared-head intake.

### Prepared-head intake

`.github/workflows/dependabot-prepared-head-intake.yml` is a distinct
credentialless `repository_dispatch` boundary with event type
`dependabot-prepared-head`. The dispatch must be authored by the exact
configured Prepare App bot ID/login. Its payload has nine top-level keys, below
GitHub's ten-key limit:

```json
{
  "schema": "dependabot-prepared-head-intake:v1",
  "repository": "mento-protocol/frontend-monorepo",
  "prNumber": 731,
  "headRef": "dependabot/...",
  "parentHeadSha": "<40 hex>",
  "headSha": "<40 hex>",
  "operation": "refresh",
  "operationReceipt": {
    "checkId": 123,
    "digest": "<64 hex>",
    "externalId": "<typed external ID>",
    "workflowRunId": 456,
    "workflowRunAttempt": 1,
    "workflowSha": "<40 hex>"
  },
  "prepareApp": {
    "slug": "<exact App slug>",
    "botId": 123456,
    "botLogin": "<exact App bot login>"
  }
}
```

The compact display title carries only PR, new head, operation kind, check ID,
digest, and receipt result. It stays at or below 220 characters at maximum
bounded field lengths. The trusted downstream workflow re-fetches the check and
full canonical receipt; the title is not authority by itself.

A malformed payload, actor mismatch, false receipt, wrong check type, extra key,
or oversized/unbound value never enters the prepared reviewer or processor.

### Trusted processor

`.github/workflows/dependabot-process.yml` consumes authenticated native
intake, prepared-head intake, and Dependabot Claude Review completions. The
bounded `dependabot-process` repository dispatch remains an operator sweep
whose payload is exactly `{"scope":"open"}`. There is no
`workflow_dispatch`.

The schedule runs at minutes `3,13,23,33,43,53` to reconcile missed events.
Immediate intake and review completions provide the normal low-latency path.
Every downstream `workflow_run` gate identifies its source by the exact
allowlisted workflow path. A custom `run-name` becomes the live run's `name`
and `display_title`, so those dynamic fields authenticate only the typed receipt
grammar and never select the source workflow.
Every entry point materializes `scripts/dependabot-processor.mjs` and its
`scripts/dependabot-preparation-receipts.mjs` validator dependency through the
GitHub Contents API at the same exact `github.workflow_sha`; it never checks out
a candidate ref.

Prepare execution has explicit phases:

- The initial read-only evaluation collects the global lane once. It validates
  its result before it exports only `refresh_required` and `refresh_pending`
  routing booleans. These booleans cannot authorize mutation or readiness. The
  workflow skips the request job for every other state.
- `request` may publish only a typed old-head Refresh request. It has no App
  credential or branch-write authority. It recollects live state before it
  publishes a request or confirms a pending request.
- `mutate` may consume only a terminal trusted request from an earlier
  Processor run. Before dispatch, the old PR base must still match the
  receipt's `previousBaseSha`, while an independent live default-branch lookup
  must match the receipt's `baseSha`. A short-lived Prepare App token then
  performs the bounded branch refresh. It cannot publish checks, approve,
  reply, resolve threads, or publish ALL CLEAR.
- `finalize` rejects `DEPENDABOT_PROCESSOR_REPAIR_TOKEN`, cannot update a
  branch, independently recollects the exact head and global lane, and alone
  may clean stale processor approvals, post packet-bound replies, approve, and
  publish ALL CLEAR.
- A phase-less invocation defaults to `finalize` for compatibility; every
  trusted workflow passes its phase explicitly. An unknown or incompatible
  phase fails closed.

### Trusted Dependabot review

`.github/workflows/dependabot-claude-review.yml` follows either credentialless
intake through `workflow_run`. Before any token, secret, or Action:

1. the first shell step authenticates upstream conclusion, event, actor ID,
   actor login/type, exact workflow path, repository, compact receipt, run ID,
   attempt, and workflow SHA;
2. it re-queries the live open non-draft Dependabot PR and exact head; and
3. for prepared heads it materializes
   `scripts/dependabot-prepared-review.mjs` at exact
   `github.workflow_sha`.

The prepared validator accepts only:

- a completed successful `Dependabot Refresh` or `Dependabot Repair` check
  published by github-actions App ID 15368;
- canonical raw JSON whose digest, external ID, run ID/attempt, and workflow SHA
  agree;
- a terminal successful trusted Actions run with the exact workflow path,
  event, repository, `main` source, and SHA;
- an exact two-parent refresh whose first parent is the prior PR head and second
  parent is the completed receipt's verified applied base, plus its successful
  old-head request;
- an exact one-parent, verified-valid Repair App bot commit, its durable staged
  intent, completed receipt, and v2 Processor packet; and
- a complete first-parent operation chain ending at a verified Dependabot seed.

The validator accepts the submitted Actions URL or GitHub's exact
`/runs/<check-id>` self URL representation, then resolves the run only from
the canonical receipt. A generic github-actions check, external ID alone,
candidate comment, or configured actor assertion cannot establish lineage.

The Claude job has only read permissions and checks out only the trusted
workflow SHA. It restricts built-in tools to Bash, denies every MCP tool, and
runs in `dontAsk` mode. It pins `claude-sonnet-4-6` so a provider
default change cannot change the reviewer model. A trusted `PreToolUse` guard authorizes one exact bound
repository-scoped `gh pr diff` command per workflow run attempt and exits with a
blocking result for every other Bash input, including suffixes, compound shell
syntax, background execution, and malformed calls. The job therefore grants no
generic Bash, `gh api`, Git, curl, web, or GitHub MCP access. It never downloads
a candidate artifact, restores a candidate cache, installs candidate
dependencies, or executes candidate code. A paired trusted `PostToolUse` guard
binds the same command and tool-use ID, rejects interrupted, background,
timed-out, empty, or persisted/truncated output, and seals a digest-bound
`dependabot-claude-review-tool-completed:v2` receipt over the original diff.
After sealing, the hook replaces the model-visible Bash result with one
`text/plain` document whose data is the exact validated stdout. This document
path bypasses Claude Code 2.1.220's 30,000-character text-result persistence,
which would otherwise replace a large successful result with a short persisted
preview that the restricted reviewer cannot reopen. A later no-token step
requires the v2 receipt, so a missing or failed diff cannot be upgraded by
schema-valid model output. Its exact bot allowlist contains only
`dependabot[bot]` and the configured Prepare App bot login.

The isolated publisher has no Claude secret or checkout. For both clean and
findings outcomes, `claude-review` check `output.text` is the exact canonical
`dependabot-claude-review-result:v1` JSON. A provenance-valid
`verdict="findings"` is deterministic repair input. A missing, malformed,
incomplete, or infrastructure-failed result is retry-first and cannot become a
repair packet.

The reviewer reports a transitive dependency change only when the diff shows a
concrete incompatible constraint or repository defect. An updated direct
package's declared internal dependency is not a separate finding only because
its version changed or it might regress. Added registry metadata, including a
deprecation notice, for an unchanged package resolution is not a finding unless
the updated dependency makes that package newly reachable or creates a concrete
incompatibility.

Dependabot review and Claude repair prefer the `ANTHROPIC_API_KEY` secret. They
use `CLAUDE_CODE_OAUTH_TOKEN` only when the API-key secret is absent. A bounded
post-action diagnostic reports only the CLI subtype, error flag, terminal
reason, and numeric API status. It never logs the model result, prompt, tool
output, or diff.

## Prepare App configuration and residual capability

Configure:

| Type     | Name                                           |
| -------- | ---------------------------------------------- |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID`   |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG`        |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_BOT_ID`          |
| Variable | `DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN`       |
| Secret   | `DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY` |

The client ID mints a short-lived installation token. The returned App slug is
verified against configuration, and the live bot account ID/login/type is
queried before mutation. Receipt authority records the verified slug and bot
identity; it does not pretend that a bot user ID is the numeric GitHub App ID.

Install the repository-scoped App with only `contents: write` and
`pull-requests: write`; GitHub's update-branch endpoint requires both. The
processor's refresh token requests both permissions. Git Data repair and
authenticated-dispatch tokens are explicitly downscoped to Contents write.
Grant no bypass, Actions, workflow, deployment, package, environment, or
provider permission.

GitHub does not offer an endpoint-level permission that permits Git writes but
denies the merge endpoint. Contents write therefore leaves a residual technical
merge capability. The control is architectural and auditable:

- no reviewed workflow or helper contains a merge call;
- the token exists only inside a repair-staging, ref-mutation/refresh, or
  authenticated-dispatch job;
- no such job has approval or ALL CLEAR authority;
- the token is revoked/invalidated at job completion; and
- finalize runs later without the App credential.

Never substitute the normal `GITHUB_TOKEN`, preview worker credential, Vercel
or package credential, deployment token, or a PAT.

The App ref move makes the Prepare App the later `synchronize` event sender.
Direct pull-request workflows therefore compute
`ALLOW_REPOSITORY_CREDENTIALS` from the signed event before candidate code
runs. The positive grant requires a same-repository `User` PR author and
`User` sender. It explicitly denies the Dependabot account, the Prepare App
bot, and `dependabot` refs. CI, E2E, and visual jobs materialize repository
secrets only from that plan-job output. A missing or false output leaves every
secret empty. Quality Budgets uses the same positive event grant without a
separate planner because it has no repository secret. Prepared Dependabot jobs
also disable dependency, Foundry, and Trunk caches, do not persist checkout
credentials, and receive no candidate-execution write token. Because the grant
is part of direct PR workflow code, the Prepare App never refreshes or repairs
a generation whose live diff contains `.github/workflows/**` or
`.github/actions/**`. Each ref mutator re-fetches the exact current file
inventory immediately before its write. Pull-request OSV jobs use the local
`_osv-scanner-readonly.yml` adapter and stay read-only. Separate schedule/manual
jobs own SARIF write authority.

## Modes and handling tiers

| Mode      | Classification | Packet                        | Refresh/repair/re-review | Approval/ALL CLEAR  | Merge |
| --------- | -------------- | ----------------------------- | ------------------------ | ------------------- | ----- |
| `observe` | Yes            | No                            | No                       | No                  | Never |
| `assist`  | Yes            | No; non-authorizing evidence  | No                       | No                  | Never |
| `prepare` | Yes            | v2 generic or v3 typed packet | Eligible bounded path    | Exact finalize only | Never |

Unknown values normalize to `observe` before any credential is exposed.

Handling tier and preparation eligibility are separate:

- **preparable**: verified npm updates, including grouped and major updates, may
  be refreshed, repaired, and fully prepared. A verified non-sensitive GitHub
  Actions update may be fully prepared only on its current, green, native
  Dependabot head. It never enters a Prepare App refresh or repair. A stale or
  failing Actions update stays manual. The dependency names, update type,
  ecosystem, and risk tier remain visible to the maintainer.
- **manual**: sensitive/self-reviewing Actions; workflow-policy, deployment,
  authentication, credential, or security Actions; unknown ecosystem or
  metadata; and any policy shape not explicitly admitted.
- **vetoed**: human veto/close/reopen, untrusted force-push history, unresolved
  or malformed feedback, untrusted actor, or ambiguous/capped evidence.

The preparable tier is broader than the former automatic tier. It does not grant
automatic merge authority. It authorizes only bounded preparation for a human
decision.

Two preparation dispositions are intentionally terminal for the current sweep:

- `repair-pending` means the exact head already has its trusted attempt packet.
  The PR keeps the serialized lane, the processor preserves that original
  packet/run for retry, and later sweeps publish neither a second packet nor an
  identical Processor check.
- `manual-repair-required` means deterministic evidence needs a change outside
  the valid bounded packet surface. The PR leaves the automatic lane for human
  repair and receives no packet.

## Exact preparation sequence

### 1. Collect and classify

The collector brackets each PR, files, commits, checks, immutable commit
metadata, feedback, and base-ancestry read with stable identity reads. It
collects every bounded thread/reply, review, issue comment, close/reopen event,
force-push event, and native `AutoMergeRequest`. For force pushes, it reads the
bounded GraphQL timeline without dropping event order or before/after commit
pairs. It caches exact historical commit evidence within the processor run.
Any collection cap, pagination ambiguity, malformed SHA/envelope, unknown
authority-bearing bot, or identity drift fails closed.

The controller treats an exact `@dependabot rebase` or `@dependabot recreate`
issue comment from a trusted maintainer as a branch-maintenance command. It does
not treat these two commands as vetoes. Added text, other Dependabot commands,
and all other trusted-maintainer issue comments remain vetoes.

Only an exact `@dependabot recreate` command can establish a new native
generation boundary after poisoned branch history. The comment must have a
trusted-maintainer actor, valid identity fields, an exact body, and matching
creation and update timestamps. The boundary event and every later event
must have a later timestamp, target the exact PR ref, come from the exact
Dependabot bot identity, form a continuous non-cyclic suffix, and land only on
signed native Dependabot commits. The controller never inherits the boundary
event's replaced commit. The collector uses the same boundary rule and fetches
only destination-commit evidence for the selected suffix. The evaluator then
revalidates the command, complete timeline, and signed native suffix before it
grants authority. An edited or untrusted command, a `rebase` command, a replayed
SHA, or any non-Dependabot destination after the boundary remains a veto.

The controller admits a force-pushed PR only when all events form one complete
native Dependabot rewrite chain. Every event must bind the exact PR ref, the
Dependabot bot account ID `49699333`, bot type, time, unique event ID, and valid
before/after SHAs. The SHAs must form one ordered continuous chain without a
repeated SHA. Every
referenced commit must have the exact Dependabot author, an exact Dependabot or
`web-flow` committer, one parent, and valid GitHub verification. The newest
destination must equal the current verified generation seed. Any human,
unknown, mixed, malformed, reordered, discontinuous, or capped history remains
a permanent veto unless the bounded trusted `recreate` boundary above starts a
new native suffix. Without that boundary, a rewrite that removes a Prepare App
commit breaks the chain and remains a veto.

Only exact configured gate and receipt names trigger an Actions workflow-run
provenance lookup. Unrelated checks and statuses remain raw non-authorizing
evidence and consume no run lookup. One processor job caches each exact
repository/run/attempt provenance read across its collections; the selected
post-merge gate is always re-fetched for its current snapshot.

Every required gate must report for the exact head. Attribute each failure
against the corresponding current-`main` baseline. A baseline check must come
from an allowed push, scheduled, or manual run. Its workflow branch must be
`main`, and its workflow head must equal the exact current-main SHA. PR and
PR-target runs cannot supply baseline evidence. PR-only checks have no main
baseline.

- `branch`: deterministic exact-head failure with a passing baseline;
- `baseline`: the corresponding deterministic current-main baseline also fails;
- `non-deterministic`: provider-backed head failure with a passing baseline;
- `provider-baseline`: trusted provider-backed head and main checks both report
  `error`, `failure`, `startup_failure`, or `timed_out`;
- `provider-unbaselined`: trusted provider-backed head failure whose matching
  exact-main check is missing, pending, or intentionally skipped; and
- `unknown`: untrusted source evidence, a missing or pending deterministic
  baseline, or a trusted current or baseline conclusion outside the accepted
  proof set, such as `neutral` or `cancelled`.

Only deterministic branch failures and provenance-valid Claude findings can
enter the packet's `failures` and `findings` fields. Exact repairable feedback
threads can enter `feedbackThreads`. An unknown failure always suppresses the
packet. A provider-only failure waits for a trusted retry. Prepare mode may
repair a concurrent deterministic branch failure while trusted
`non-deterministic`, `provider-baseline`, or `provider-unbaselined` failures
remain failed. Those provider failures never enter the packet and still block
approval and readiness.

The Supply Chain workflow runs `lockfile integrity + registry` and `catalog
version-skew` on every `main` push. These short jobs create exact deterministic
baselines. The four provider-backed OSV jobs remain PR, scheduled, and manual
gates. Their main-push jobs are intentionally skipped and count as unbaselined
provider evidence.

### 2. Refresh stale current-base ancestry

Prepare mode can request a refresh only after stable structural identity and
policy eligibility. It first publishes a successful `Dependabot Refresh`
request receipt on the old head. The short-lived Prepare App requests an
append-only update to the exact current base.

The completed head is accepted only when:

- it is still the same repository-owned `dependabot/*` ref and PR;
- the old head is its first parent, and its second parent is either the
  still-current requested base or the verified live-current successor admitted
  by the bounded request-to-update race reconciliation;
- the completed receipt points to the exact old-head request check and digest;
- the App bot dispatch and terminal trusted run are exact; and
- the full native/prepared chain remains rooted in the verified Dependabot seed.

A refresh never increments the repair count. The controller does not request a
Dependabot rebase, force push, or history rewrite. It only observes and
authenticates a native rewrite that Dependabot already completed.

GitHub may retarget existing review-comment commit metadata while update-branch
creates the append-only successor. The bounded old-head wait and typed
snapshot-race retry use separate counters so a late successor still gets a
stable read. The accepted read still requires a fully stable snapshot plus the
exact parent, base, App identity, and signature evidence above. Persistent drift
or any other collection error fails closed.

### 3. Produce and publish one bounded repair

A generic v2 repair packet exists only when identity/lineage, current base,
complete gate, preparable policy, and repair attempt lineage all pass. It also
requires at least one deterministic branch attribution, validated finding, or
exact repairable feedback thread. Feedback must otherwise be clear. Unknown
attribution is forbidden. Prepare mode can retain completed trusted provider
failures outside a packet with separate deterministic branch evidence. A typed
v3 packet may instead represent one admitted deterministic protected-runtime
synchronization. Its operation is actionable even with no failed check: ALL
CLEAR would otherwise leave the immutable Dependabot target unrealized across
the protected runtime. The exact Next catalog operation can proceed beside
trusted provider-baseline failures because those failures do not affect its
deterministic inputs. They remain failed and still block ALL CLEAR. Same-head
processing is idempotent. The first
append-only Repair commit consumes attempt one; a second consumes attempt two.
There is no third attempt.

Generic npm packets bind the root `package.json`, `pnpm-workspace.yaml`, and
`pnpm-lock.yaml` as companion inputs in addition to the PR files. A generic v2
plan cannot edit a dependency declaration file that Dependabot changed. This
preserves the requested update direction while still allowing an unchanged
companion declaration and the generated lockfile to repair a bounded skew.

A later generic v2 repair can follow a reachable Vercel v3 protected-runtime
sync.
The processor keeps the full PR path inventory for live diff authentication.
It admits the v2 packet only when the protected paths are exact v3 required
paths, the current runtime state matches the proven operation, and each new
Claude finding or bound review thread names an exact generic-safe changed file.
The v2 expected-blob and permitted-path sets shrink to those evidence paths.
The packet omits the protected runtime blobs and explicitly forbids
`scripts/vercel-cli-runtime/**`. A missing or changed v3 proof, another
protected path, an unsafe or absent evidence path, or a mixed branch failure
suppresses the packet and produces `manual-repair-required`.

Processor check publication is also transition-idempotent. The newest trusted
exact-head receipt must match mode, disposition/output summary, attempt, packet
flag, and packet digest before publication is skipped. Newer malformed or
untrusted evidence never suppresses a replacement. `repair-pending` retains the
original packet source rather than creating another repair run.

`.github/workflows/dependabot-prepare-repair.yml` separates planning, durable
intent, branch mutation, and recovery:

Its repository-wide concurrency group uses `queue: max` with
`cancel-in-progress: false`. GitHub can retain up to 100 pending repair or
recovery runs instead of replacing the older pending run. GitHub orders runs by
the time each run starts waiting, which can differ from dispatch order.

1. **preflight** authenticates the exact Processor v2 or v3 packet and terminal
   processor run, then selects its exact plan kind;
2. **plan** first runs the trusted `materialize-repair-evidence` command with a
   step-scoped read token. The command authenticates the packet and live PR,
   binds the exact base-to-head compare, re-fetches every expected file through
   the Git blob API, collects only packet-bound failed-job logs and findings,
   and seals a canonical manifest plus synthetic evidence files under
   `RUNNER_TEMP`. Claude then runs through the pinned token-free base action
   with only guarded `Read` and `Grep` access to those files and a strict JSON
   schema. Its model-visible tool surface has no Bash/Edit/Write, general
   network, MCP, candidate checkout, or mutation capability. The workflow-only
   `DEPENDABOT_REPAIR_EVIDENCE_ROOT`,
   `DEPENDABOT_REPAIR_EVIDENCE_MANIFEST`, and
   `DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST` values bind the hook to that
   sealed directory and manifest. Paired pre/post hooks seal successful exact
   accesses; large files require explicit one-based bounded Read pages, and Grep
   may locate the relevant ranges. A no-token postflight assertion requires at
   least one successful exact access before the generic plan job succeeds.
   A v3 packet takes the mutually exclusive model-free path instead. The
   `vercel-cli-runtime-sync` kind reads the same exact blob evidence, fetches
   the exact current and target public npm records, changes only the Vercel
   regions of the root lock, and regenerates the standalone lock twice. The
   `next-catalog-override-sync` kind admits only the exact `frontend-core`
   Next row. It moves the catalog, root override, and protected-runtime
   override forward to the immutable target. It starts from the sealed source
   root lock and runs one isolated pinned-pnpm target solve as an oracle. It
   imports only the exact Next runtime closure records and integrity values
   from that oracle into the source lock. Exact registry metadata also binds
   the Next package peers, optional-peer metadata, Node engine, bin shape, and
   retained snapshot peer context. It preserves every unrelated source
   resolution. The packet's `resolutionMode: lowest-direct` constrains only
   the oracle and does not define the output lock. The generator rotates the
   exact Next override in the sealed standalone lock, requires frozen-lock
   consistency, and reseals the runtime contract. Both kinds disable scripts
   and pnpmfile loading. Standalone checks also disable workspace linking. They
   emit only their fixed output-path patches;
3. **validate** has no secret or write token. It re-fetches exact inputs by Git
   object SHA, including files larger than the Contents API limit, applies
   patches in a disposable credential-free temporary Git tree, enforces
   permitted/forbidden paths, file/edit/byte caps, exact
   packet/head/base/check IDs, and emits a digest-bound plan. For the typed v3
   path it also regenerates independently and requires exact plan equality;
4. **candidate CLI smoke** runs only for typed v3 after trusted validation on a
   fresh no-output runner. It reapplies the digest-bound validated patches to
   freshly materialized exact packet evidence and requires every result digest
   to match the validated plan. It does not run another registry oracle or
   regenerate the plan. API and shell steps materialize the exact trusted
   scripts, a byte-identical sealed Node executable, and the npm-locked,
   hash-verified pnpm bootstrap. The job registers
   no runner action or post action before candidate code. A separate non-sudo
   account cannot write the trusted source, evidence, copied Node executable,
   pnpm executable, workspace, Actions directory, or runner command files. The
   candidate `PATH` contains only checked non-writable directories and excludes
   the runner-owned `/usr/local/bin` directory. The job first
   performs secretless frozen lock checks with scripts and pnpmfile loading
   disabled. It installs the standalone runtime and checks its exact CLI
   version. The Next kind finishes with a cacheless frozen install of only the
   selected app's production dependencies. Lifecycle scripts run inside a
   sanitized environment. It executes the exact target Next CLI and builds a
   minimal App Router project. Candidate execution is the final step: it can
   veto staging but cannot change the validated plan or produce downstream
   authority;
5. **stage** alone receives a short-lived Prepare App token and writes exact
   unreachable blobs, tree, and one commit without moving the branch;
6. **intent** has no App token. It publishes `Dependabot Repair Intent`
   (`dependabot-repair-intent:v1`) on the staged successor, binding the packet,
   plan, old head, tree, result blobs, exact workflow run, and expected new head;
7. **mutate** receives a fresh Prepare App token, revalidates the intent and
   exact current ref, then moves only that `dependabot/*` ref with
   `force=false`. It then polls the read-only PR view up to five times when
   GitHub still returns the exact parent state. It never repeats the ref write
   and fails immediately on any other drift; and
8. **receipt/recovery** has no App token. It publishes the completed
   `Dependabot Repair` check, or recovers that check idempotently after a failed,
   cancelled, timed-out, action-required, or startup-failed source run only when
   the exact intent-bound commit is already the current PR head.

The staged tree is never executed. The Repair commit must have the configured
Prepare App bot as its exact author and either that bot or GitHub's exact
`web-flow` system user as its committer, with GitHub verification
`verified=true` and reason `valid`. GitHub uses `web-flow` when it server-signs
a Git Data commit created by an App without custom author, committer, or
signature fields. A staged intent is inert if its commit did not become the PR
head. `Dependabot Prepared Head Dispatch` sends prepared-head intake only from
a successful completed Repair receipt. Only the exact retryable non-success
conclusions above may trigger bounded retry or the checks-only recovery path;
they never establish completion authority by themselves.

Infrastructure retry count is separate from the two-commit repair attempt. A
normal failure before the ref move re-authenticates and redispatches the exact
Processor packet at counts one and two. Any normal failure after the exact ref
move enters recovery at count zero, including when the normal run was already
retry two. Failed checks-only recovery may retry at counts one and two. Count
two is terminal; retry never changes the packet, plan, intent, head, or repair
attempt.

### 4. Re-review and recollect

The prepared-head intake starts a new exact-head Claude review and processor
cycle. Discard every old check, review, base, and feedback conclusion.

A generic v2 packet may bind a validated Claude finding or review thread only by exact
identifier, commit/head, and body digest. After the repaired head has a clean
re-review and complete green gate, finalize may post only:

`Fixed in <current-head prefix> — <concrete change>`

and resolve only those packet-bound threads. It must then collect feedback
again. Generic github-actions comments/replies, unbound bot output, or a model
claim never satisfy feedback. Automated `Won't fix` is not permitted; that
decision remains human.

A v3 Vercel or Next sync may bind an exact Cursor thread only when its
structured finding matches the typed operation. Vercel accepts only
`Incomplete Vercel CLI runtime sync` on root `package.json`. Next accepts only
`Next bump never applied` on root `pnpm-lock.yaml`. Each finding must name the
operation's source and target versions and bind a review commit from the
authenticated prepare lineage. This can be the seed, the current head, or an
authenticated intermediate repair head that remains after a required refresh.
The PR #723 recovery exposed this case: the refresh moved `f7dbbe33` to
`f628c05d`, while the exact Cursor review remained immutably bound to
`f7dbbe33`. A commit outside the authenticated lineage remains manual. All
actionable threads must match the same operation contract.
Any other unresolved feedback makes the typed operation manual. The completed
typed Repair then uses the same digest-bound reply and resolution flow above.
Evidence authenticates the REST comment's immutable `original_commit_id`. It
accepts the mutable `commit_id` only when it names that original review commit
or the exact packet head because GitHub retargets current comment metadata
after a refresh.

For historical Codex feedback, `Reviewed commit` binds the parent review's own
`reviewCommitSha`, not the repaired current head. Its unresolved historical
thread still blocks; a resolved historical thread clears. If an exact
packet/PR/head/thread-bound remediation reply already exists, a retry does not
post it again and retries only thread resolution.

### 5. Finalize one ALL CLEAR candidate

Before readiness publication, finalize:

1. proves there is no native `AutoMergeRequest` on any Dependabot PR;
2. discovers the repository-wide approval/ALL CLEAR inventory, preserves and
   prioritizes one still-valid active candidate even when it is outside a
   targeted run, and dismisses only stale or invalid authority;
3. recollects the selected PR and global lane from scratch;
4. proves exact native or prepared lineage, current `main` ancestry, stable
   `updated_at`, complete green gates, clean exact-head Claude review, and
   clear feedback;
5. requires GitHub `mergeable`, `mergeStateStatus`, review decision, branch
   protection/ruleset, and required-check state to be satisfied;
6. creates one exact-head processor approval with the normal workflow token;
7. recollects the selected PR, then immediately re-reads the repository-wide
   approval inventory and proves it contains exactly that new approval ID, PR,
   and head with no other evidence change; and
8. publishes a successful `Dependabot ALL CLEAR` receipt.

The Prepare App token is absent throughout finalize. The processor approval
satisfies the repository's review rule; it does not authorize code to merge.
If any post-approval gate fails while the PR remains open, dismiss the approval
and do not publish success.

## Typed receipt contracts

All authority-bearing check output is exact recursively key-sorted compact JSON.
SHA-256 is computed over those exact bytes. The publisher is github-actions App
ID 15368, but that shared identity alone grants no authority. Every receipt also
binds its exact terminal trusted workflow run ID, attempt, workflow SHA, path,
event, repository, `main` source, status, and conclusion. GitHub's self check
URL is accepted only for the same check ID and resolved canonical run.

### Processor v2 and repair packets v2/v3

A Processor check with `packet=false:digest=none` is a non-authorizing status
record. It has no `output.text` packet and does not enter repair-receipt,
attempt, or prepared-lineage accounting. The processor still binds its exact
trusted workflow identity, PR, head, run, and attempt. The source run can still
be active, or can later fail, without turning that status into repair
authority. Every `packet=true` check keeps the strict terminal-success source
requirement below.

Finalization publishes this status before it creates the approval. If later
admission fails, cleanup dismisses the approval without reclassifying the live
status as repair evidence.

A packet-issued Processor check uses:

`dependabot-processor:v2:pr=<n>:head=<sha>:mode=prepare:repair=<1|2>:packet=true:digest=<digest>:run=<run-id>:attempt=<run-attempt>`

Its `output.text` is the exact canonical
`dependabot-repair-packet:v2` or `dependabot-repair-packet:v3` JSON. It is
deliberately a completed **failure** check while repair is required, so it
cannot unblock merge. Both schemas bind the exact workflow run/SHA,
PR/head/base, attempt, policy/risk, permitted/forbidden paths, caps, validation,
and escalation. V2 additionally requires deterministic failure, finding, or
feedback evidence.

V3 is reserved for the exact
`dependabot-protected-runtime-sync:v1` operation. The
`vercel-cli-runtime-sync` kind binds the immutable seed Vercel row, stable
same-major patch/minor target, exact pnpm 10.34.4, exact current-head input
blobs, and the fixed five root/runtime output paths. The
`next-catalog-override-sync` kind binds the exact immutable `frontend-core`
Next row, caret source and target specs, the same exact pnpm and input set, and
six outputs: the root package/workspace/lock plus the standalone runtime
contract/manifest/lock. Its lock patch can exceed the generic 8 KiB per-edit
cap, but the larger allowance applies only to this typed kind and remains under
the 64 KiB aggregate plan cap. A v3 packet may carry empty
failure/finding/feedback arrays because the missing typed synchronization is the
actionable invariant. The Vercel and Next kinds may instead carry only their
exact matching Cursor threads described above. Mixed v2 attempt-one and v3
attempt-two lineage remains valid only when every packet, Intent, commit,
receipt, operation digest, target version, and current-tree contract matches.

### Refresh v1

Requested receipt exact keys:

`baseSha, headRef, headSha=null, parentHeadSha, prepareAppSlug, prepareBotId, prepareBotLogin, previousBaseSha, pullRequestNumber, repository, schema, state, workflowRunAttempt, workflowRunId, workflowSha`

Completed adds `requestCheckId` and `requestDigest`, sets
`headSha=<new head>`, and records the actual second parent in `baseSha`. That
parent can differ from the requested base only through the bounded verified
request-to-update race reconciliation. An older applied base can remain valid
lineage, but current-base readiness still requires another refresh.

External ID:

`dependabot-refresh:v1:pr=<n>:head=<bound head>:state=<requested|completed>:digest=<digest>:run=<run-id>:attempt=<run-attempt>`

Both checks are completed success.

### Repair intent v1

Intent exact keys:

`attempt, baseSha, edits, editsDigest, headRef, headSha, packetDigest, parentHeadSha, parentTreeSha, prepareAppSlug, prepareBotId, prepareBotLogin, processorCheckId, pullRequestNumber, repository, retryCount, schema, state, treeDigest, treeSha, validatedPlanDigest, workflowRunAttempt, workflowRunId, workflowSha`

External ID:

`dependabot-repair-intent:v1:pr=<n>:head=<staged head>:attempt=<repair attempt>:digest=<digest>:run=<run-id>:run_attempt=<run-attempt>`

The completed-success intent is non-readiness evidence. `retryCount` records
the bounded normal infrastructure retry that produced it. `edits` contains one
to six objects with exactly
`contentDigest, expectedBlobSha, mode, path, resultBlobSha, type`. Paths are
unique, each result blob differs from its expected blob, `type` is `blob`, and
`mode` is `100644` or `100755`. The intent binds one exact validated staged
successor before the branch moves. Mutation or recovery must
re-fetch and match its source run, Processor packet, exact tree/blobs, App
identity, verified-valid commit, and current PR ref.

### Repair v1

Completed receipt exact keys:

`attempt, baseSha, headRef, headSha, packetDigest, parentHeadSha, prepareAppSlug, prepareBotId, prepareBotLogin, processorCheckId, pullRequestNumber, repository, schema, state, workflowRunAttempt, workflowRunId, workflowSha`

External ID:

`dependabot-repair:v1:pr=<n>:head=<new head>:attempt=<repair attempt>:digest=<digest>:run=<run-id>:run_attempt=<run-attempt>`

The check is completed success. `processorCheckId` and `packetDigest` bind the
exact parent-head Processor failure check and canonical v2 or v3 packet.

### ALL CLEAR v1

ALL CLEAR top-level keys are exactly:

`autoMergeEnabled, baseSha, checksDigest, feedbackDigest, headRef, headSha, humanAction, mergeAuthorizedByAutomation, mergeStateStatus, mergeable, preparation, processorApprovalId, pullRequestNumber, repository, reviewDecision, riskTier, schema, updateType, workflowRunAttempt, workflowRunId, workflowSha`.

Fixed values are `humanAction="merge"`,
`mergeAuthorizedByAutomation=false`, `autoMergeEnabled=false`,
`mergeable=true`, `mergeStateStatus="CLEAN"`, and
`reviewDecision="APPROVED"`.

Its `preparation` object is either:

- native: `{kind:"native",seedHeadSha,refreshCount:0,repairCount:0,operationDigests:[]}`; or
- prepared:
  `{kind:"prepared",seedHeadSha,refreshCount,repairCount,operationDigests,prepareAppSlug,prepareBotId,prepareBotLogin}`.

For a prepared lineage, `operationDigests.length` equals
`refreshCount + repairCount`, and every operation digest is unique.

External ID:

`dependabot-all-clear:v1:pr=<n>:head=<sha>:base=<sha>:digest=<digest>:run=<run-id>:attempt=<run-attempt>`

A native verified Dependabot seed can finalize without minting the Prepare App
token.

## Native auto-merge and approval cleanup

Treat every GitHub `AutoMergeRequest` as mutation risk. Prepare mode removes a
sole exact candidate request only as an authority-reducing cleanup and then
recollects; another, multiple, malformed, or newly appearing request blocks.
Observe and assist never publish a readiness check while a request exists.
The controller never creates a native request.

A crash can strand a processor approval. Before any approval or readiness
publication, scan every open Dependabot PR. If the sole current approval has an
exact matching, current-base ALL CLEAR receipt, collect and revalidate that PR
even when the run targeted another PR, then keep it pinned. Otherwise dismiss
every independently schema-valid stale current-head processor approval with the
normal token, including multiple approvals or approvals outside the selected
PR, and prove the bounded global rescan is empty. An unknown or malformed
current-head github-actions approval requires operator resolution. Recollect
selected PRs and auto-merge state after cleanup; pre-cleanup evidence is stale.

If a post-approval revalidation fails, publish an automation-invalidating
exact-head ALL CLEAR failure before dismissal. This optional failed check does
not remove GitHub merge authority; dismissal does. GitHub can keep the failed
check as `UNSTABLE` after the approval is gone. A later finalize run may publish
a newer neutral tombstone only after a fresh repository-wide scan proves zero
processor approvals and the exact PR reports `REVIEW_REQUIRED`, `BLOCKED`, and
no auto-merge. It recollects and proves the neutral tombstone and the same
non-authorizing state before it can approve again. Any approval found during
that proof causes failure restoration and dismissal. A later run changes a
persisted tombstone back to failure before it repeats the proof. Recovery
rollback restores every target whose neutral publication started, disables a
sole exact auto-merge request, and dismisses every processor approval that any
rollback scan observes. Two consecutive paired global scans must prove both
authority inventories empty within five attempts. A final scan that first
exposes a processor approval or sole exact auto-merge request removes that
authority and fails because it cannot prove the required empty sequence.
Post-approval admission or publication failure uses the same rollback. It
blocks every normalized authority target, dismisses every observed processor
approval, and disables a sole exact auto-merge request. Multiple, malformed, or
ambiguous auto-merge evidence remains blocking and fails closed. This includes
authority that appears after an ambiguous API response. Each confirmation
round reads both global inventories. Authority observed in either inventory
read resets the empty sequence.
The tombstone external ID is
`dependabot-all-clear-tombstone:v1:pr=<n>:head=<sha>` and never parses as an ALL
CLEAR receipt.

## Serial human merge and post-merge proof

There is at most one successful ALL CLEAR candidate. A valid active receipt and
its sole exact approval outrank numeric candidate selection; targeted and global
runs both collect and preserve that incumbent until it merges or becomes
invalid. The maintainer checks that the receipt still targets the visible head
and clicks the normal squash Merge button. The repository ruleset must reject
stale base, changed head, failed check, missing approval, or lost review state
at click time.

In prepare mode, a targeted event expands collection to the bounded set of all
open Dependabot PRs while its expected-head assertion remains bound only to the
triggering PR. One durable preparation incumbent also outranks numeric
selection: a pending Refresh request or completion, a trusted same-head repair
packet, or a valid prepared lineage keeps the lane while it waits for checks,
retry, or re-review. Multiple incumbents without one valid active ALL CLEAR
authority fail closed. Terminal manual, vetoed, or rejected identities leave
the automatic lane, and every other preparable PR waits for serialization.

The controller does not claim to eliminate the final-read race. A comment,
review, ruleset change, native auto-merge request, or `main` push can land
after final recollection. If GitHub does not block the click, the maintainer must
stop and rerun preparation.

After merge, keep the lane occupied until the exact merge SHA has:

1. successful full default-branch `CI/CD`;
2. the applicable `Vercel Main Deployment`; and
3. successful exact-main `Dependabot Post-Merge Verification` with terminal
   release, smoke, and recovery evidence, or a verified no-target outcome.

Do not admit another ALL CLEAR candidate while main CI/release proof is missing
or failed. Follow the managed failure issue and deployment recovery runbook.

## Failure handling

| Evidence/outcome                                       | Action                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Malformed/false intake or dispatch                     | Fail; inspect actor and exact envelope.                           |
| Head/base/feedback changed before mutation             | Make no mutation; start a fresh exact-head cycle.                 |
| Snapshot race after one authorized refresh request     | Retry read-only collection within the bounded successor poll.     |
| Missing/pending current gate or deterministic baseline | Wait for trusted evidence; recollect.                             |
| Deterministic baseline failure                         | Repair `main`, prove recovery, then refresh affected PRs.         |
| Provider-only/Claude infrastructure failure            | Retry through the trusted provider path; never patch around it.   |
| Provider failure plus deterministic branch failure     | In prepare mode, packetize only the deterministic branch failure. |
| Repair/recovery infrastructure failure                 | Retry exact evidence twice per phase; then require investigation. |
| Valid Claude findings                                  | Treat as deterministic packet input, not infrastructure failure.  |
| Eligible deterministic branch failure                  | Publish v2 packet only when the bounded repair surface is valid.  |
| Admitted Vercel protected-runtime target missing       | Publish exact v3 model-free sync packet; require typed proof.     |
| Admitted Next catalog/override target missing          | Publish exact v3 model-free sync packet; preserve forward intent. |
| Existing exact-head packet (`repair-pending`)          | Preserve its run; publish no duplicate packet/check.              |
| No valid automatic packet (`manual-repair-required`)   | Leave the lane and require human repair.                          |
| Refresh needed                                         | Use request/completed v1 lineage; do not spend repair budget.     |
| Current reviewed pin fails pnpm release-age check      | Add one exact-version exception; remove it after maturity.        |
| Repair plan malformed/out of scope                     | Fail before App token mutation; escalate manual.                  |
| Repair attempts exhausted                              | Manual handling; do not reset with rebase/force-push.             |
| Sensitive/unknown/manual tier                          | Record evidence and require human dependency handling.            |
| Human veto/close/reopen or untrusted force-push        | Stop preparation for this PR.                                     |
| Exact native-to-native Dependabot rewrite chain        | Start a new generation; recollect all exact-head evidence.        |
| Unresolved/unbound feedback                            | Block; never infer a reply or resolution.                         |
| Auto-merge request or competing candidate              | Remove only exact safe stale authority, recollect, or block.      |
| Mergeability/ruleset/review unsatisfied                | Do not approve or publish ALL CLEAR.                              |
| Finalize drift after approval                          | Dismiss processor approval and reprocess.                         |
| ALL CLEAR published                                    | Human verifies current head and clicks Merge.                     |
| Main CI/release proof failed                           | Keep lane occupied and follow recovery.                           |
| Ambiguous/capped evidence                              | Fail closed and require operator investigation.                   |

## Commands and reporting

Evaluate a saved snapshot without network or mutation:

```bash
pnpm dependabot:process -- evaluate --input path/to/snapshot.json --mode observe
```

Run the complete processor, workflow, receipt, repair, and reviewer contract
suite after any related code, workflow, configuration, or documentation change:

```bash
pnpm dependabot:process:test
```

Run the opt-in public-registry Next source-preserving sync proof after changing
the typed generator or its pnpm contract:

```bash
NEXT_CATALOG_SYNC_INTEGRATION=1 pnpm exec node --test scripts/dependabot-protected-runtime-sync.test.mjs
```

When reporting, distinguish:

- classified vs packet-issued;
- refresh requested vs completed;
- repair planned vs validated vs pushed;
- review findings vs clean re-review;
- processor approved vs ALL CLEAR;
- ALL CLEAR vs human merged; and
- merged vs exact-main CI/release proven.

Include mode, workflow/run/attempt/SHA, PR/head/base, risk/preparable tier,
attribution, refresh/repair counts, operation digests, review verdict, feedback
state, approval ID, ALL CLEAR check ID, human merge SHA if it exists, and
post-merge proof.

## References

- [Dependabot on GitHub Actions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)
- [GitHub `workflow_run` security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Claude Code Action security](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
- [GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [GitHub signature verification for bots](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-bots)
- [Repository dispatch](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)
- [GitHub Checks API](https://docs.github.com/en/rest/checks/runs)
- [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
