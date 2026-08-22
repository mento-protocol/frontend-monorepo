---
title: Authenticated native Dependabot rewrites start new preparation generations
status: active
owner: eng
canonical: true
last_verified: 2026-08-22
scope: ci/dependabot-native-generation
date: 2026-08-22
---

# ADR 0008 — Authenticated native Dependabot rewrites start new preparation generations

**Status:** Accepted
**Scope:** ci/dependabot-native-generation

## Context

ADR 0006 originally treated every observed force push as a permanent veto. The
rule protected append-only Refresh and Repair receipt accounting. It also
blocked normal Dependabot updates because Dependabot replaces its own generated
commit when the base or dependency set changes.

PR #723 exposed the false veto. GitHub recorded eleven force-push events. Every
event came from the exact Dependabot bot, and the events formed one continuous
native commit chain to the current verified head. The old rule still removed
preparation authority.

An actor-login exception is insufficient. A summary of distinct actors and
destination SHAs loses event order, actor IDs, before/after pairing, and
evidence above the summary cap. It cannot detect a native rewrite that removed
a maintainer or Prepare App commit. Such a rewrite could reset reachable repair
receipts and the two-repair budget.

## Decision

The controller treats a complete authenticated native-to-native Dependabot
rewrite chain as a new preparation generation. It keeps every other force-push
history as a permanent PR veto.

The controller collects `HeadRefForcePushedEvent` records from the bounded
GitHub GraphQL pull-request timeline. It preserves each event ID, creation time,
exact ref, actor tuple, before SHA, and after SHA. It also fetches every unique
referenced commit from the GitHub commit API. It caches that immutable commit
evidence within one processor run.

The controller admits the generation only when all of these conditions hold:

1. The GraphQL event count is positive, complete, and at most the hard limit.
2. Every event has a unique ID and a valid creation time.
3. Every event names the exact PR head ref.
4. Every actor is GitHub Dependabot bot ID `49699333` and type `Bot`.
5. Every before and after value is a distinct lowercase 40-character SHA.
6. Event times increase, each after SHA equals the next before SHA, and the full
   chain contains no repeated SHA.
7. Every referenced commit has the exact Dependabot author ID, login, and type.
8. Every referenced commit has the exact Dependabot committer or exact
   `web-flow` user ID `19864447` and type `User`.
9. Every referenced commit has one parent and GitHub verification state
   `verified=true`, `reason=valid`.
10. The PR author has the exact Dependabot ID, login, and type.
11. The newest after SHA equals the current reachable verified Dependabot seed.
12. Immutable metadata binds that same seed.

The current head can contain later Prepare App commits. Existing typed receipts
and parent checks must prove that append-only lineage from the admitted native
seed. A later native rewrite cannot erase such a commit and retain authority:
the event's before commit would fail the exact native commit census. When an
earlier native event exists, the Prepare App commit also breaks continuity
between the prior after SHA and the next before SHA.

The controller counts only Refresh and Repair receipts reachable from the
current generation seed. A valid native rewrite therefore starts with no prior
attempts. It does not inherit discarded receipts.

The controller does not ask Dependabot to rebase or force push. It only observes
and authenticates a rewrite that Dependabot already completed. The current-head
native intake, review, check, risk, feedback, ruleset, approval, and ALL CLEAR
requirements from ADR 0006 remain unchanged. Human merge remains mandatory.

## Alternatives considered

### Ignore force pushes when the summary contains the Dependabot login

Rejected. The summary loses tuple identity, order, before/after continuity, and
cap completeness. Login text alone does not authenticate the GitHub account.

### Keep every force push as a permanent veto

Rejected. It blocks routine Dependabot regeneration even when GitHub provides
complete native provenance. PR #723 remained manual after eleven valid native
rewrites.

### Trust only the latest force-push event

Rejected. A latest-only rule can hide an earlier human, unknown, malformed, or
Prepare App rewrite. The controller must validate the full bounded chain.

### Use only the native intake receipt

Rejected as the generation classifier. Native intake proves the current event
sender and head. It does not preserve the complete historical before/after
chain. It remains required downstream as current-head review provenance.

## Consequences

- PR #723 and equivalent native rewrite histories can enter `prepare`.
- Human, unknown, mixed, malformed, reordered, discontinuous, or capped
  histories remain manual.
- A rewrite cannot erase a prepared commit and reset the repair budget.
- Force-pushed PR collection adds one bounded GraphQL query and immutable commit
  reads. Per-run caching removes duplicate historical commit reads during
  recollection.
- The permanent veto now applies to the PR history. The native exception starts
  a new generation only after the complete stronger proof passes.

## Evidence

- `pnpm dependabot:process:test`
- Live read-only evaluation of PR #723 at exact head
  `6e13cc863ee920db194e981c22482d8680a18f49`
- Eleven exact GraphQL force-push events from Dependabot bot ID `49699333`
- One continuous event chain from `4f291c6f051fe9669316ef8f240b4ac2e9ed3214`
  to the exact current seed
