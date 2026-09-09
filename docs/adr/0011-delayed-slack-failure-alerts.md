---
title: Delay and coalesce Slack failure alerts
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

The Slack side channel needs one useful alert without becoming a second incident
state store. GitHub workflow concurrency cannot safely elect the first failure:
its queue can replace an older pending callback and discard the episode owner.

## Decision

Wait 15 minutes in each failure callback. Then list decisive runs in the same
workflow, event, target-ref, and source-repository partition. Suppress the post
when a newer success recovered the callback. Also suppress it when an earlier
failure already owns the active episode. Let API errors fail open so an
unexpected duplicate is possible but a real alert is not silently lost.

Keep the managed GitHub issue as the durable incident record. Store no Slack
receipt and do not update old Slack messages after recovery. Label a Vercel main
deployment `head_sha` as the controller commit because the nested event does not
expose the deployed source SHA.

## Alternatives considered

- Post every failure immediately. This caused the alert noise addressed here.
- Use workflow concurrency to cancel a waiting alert after success. GitHub can
  replace a pending failure callback and lose the only episode owner.
- Store Slack receipts and update messages after recovery. This adds durable
  cross-run state, more Slack operations, and a separate reconciliation system.
- Read logs and suppress known error text. Logs are untrusted and text matching
  can hide a different failure.

## Consequences

A sustained incident reaches Slack after 15 minutes. The managed issue still
opens immediately. A recovered incident does not post to Slack. A sustained
episode posts once even when later commits also fail. A posted Slack message
stays red after recovery; the managed issue records the recovery.

Each failure consumes about 15 minutes of runner time. Reconsider the delay if
automatic recovery commonly approaches 15 minutes or incident response needs a
faster Slack signal. Reconsider receipt storage only if stale Slack messages
cause operational confusion after this change.

## Evidence

- [Slack notification runbook](../quality-budgets.md#slack-notification)
- [Slack notifier workflow](../../.github/workflows/notify-slack-on-main-failure.yml)
- [Managed Vercel failure issue](https://github.com/mento-protocol/frontend-monorepo/issues/636)
