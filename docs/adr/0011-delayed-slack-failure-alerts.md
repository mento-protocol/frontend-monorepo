---
title: Delay Slack failure alerts
status: active
owner: eng
canonical: true
last_verified: 2026-09-09
scope: ci-failure-notification
date: 2026-09-09
---

# ADR 0011 — Delayed Slack failure alerts

## Status

Accepted.

## Context

The managed GitHub issue opens on a decisive failure and closes after recovery.
Slack previously posted every failure immediately. Expected stale-source stops
and short provider errors therefore produced several red messages for incidents
that recovered automatically.

The Slack side channel must suppress short recovered incidents without becoming
a second incident state store. It cannot safely coalesce sustained failures
unless it records whether an earlier Slack delivery succeeded.

## Decision

Wait 15 minutes in each failure callback. Then list decisive runs in the same
workflow, event, target-ref, and source-repository partition. Suppress the post
when a newer success recovered the callback. Let every sustained failure post.
Let API errors fail open so a real alert is not silently lost.

Keep the managed GitHub issue as the durable incident record. Store no Slack
receipt and do not update old Slack messages after recovery. Label a Vercel main
deployment `head_sha` as the controller commit because the nested event does not
expose the deployed source SHA.

## Alternatives considered

- Post every failure immediately. This caused the alert noise addressed here.
- Use workflow concurrency to cancel a waiting alert after success. GitHub can
  replace a pending failure callback before it evaluates current state.
- Use a GitHub Environment wait timer. This moves the delay into mutable
  repository settings. It also delays the manual wiring test or requires a
  separate test job.
- Suppress later failures in the same incident. Without a delivery receipt, a
  failed first notification can suppress every later notification.
- Store Slack receipts and update messages after recovery. This adds durable
  cross-run state, more Slack operations, and a separate reconciliation system.
- Read logs and suppress known error text. Logs are untrusted and text matching
  can hide a different failure.

## Consequences

A sustained incident reaches Slack after 15 minutes. The managed issue still
opens immediately. A recovered incident does not post to Slack. A sustained
failure posts. A posted Slack message stays red after recovery; the managed
issue records the recovery. Continued failures can produce repeated messages.

Each failure consumes about 15 minutes of runner time. Reconsider the delay if
automatic recovery commonly approaches 15 minutes or incident response needs a
faster Slack signal. Reconsider receipt storage if repeated sustained-failure
messages or stale Slack messages cause operational confusion after this change.

## Evidence

- [Slack notification runbook](../quality-budgets.md#slack-notification)
- [Slack notifier workflow](../../.github/workflows/notify-slack-on-main-failure.yml)
- [PR #946 review](https://github.com/mento-protocol/frontend-monorepo/pull/946)
- [Managed Vercel failure issue](https://github.com/mento-protocol/frontend-monorepo/issues/636)
