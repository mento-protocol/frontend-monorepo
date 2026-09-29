---
title: Sanctions screening uses the OFAC SDN list
status: active
owner: eng
canonical: true
last_verified: 2026-09-29
scope: app.mento.org
date: 2026-09-29
---

# ADR 0014 — Sanctions screening uses the OFAC SDN list

## Status

Accepted.

## Context

`app.mento.org` blocks a connected wallet when `/api/sanctions` answers
`{ isSanctioned: true }`. The app-wide guard (`app/hooks/use-sanctions-check.ts`,
`app/components/sanctions-guard.tsx`) and the bridge validator both depend on
that contract, and both treat any other answer as a failed check.

The route called Chainalysis's free Sanctions API,
`https://public.chainalysis.com/api/v1/address/<address>`, with the
`CHAINALYSIS_API_KEY` secret. Chainalysis has discontinued that API, so every
lookup failed. #994 then made the route fail open with a `degraded` flag so
that wallets were not all blocked, which turned screening off.

The free API wrapped OFAC's Specially Designated Nationals (SDN) list, which is
public. Measured on 2026-09-29:

- `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV`
  answers `302` with no key, to a pre-signed S3 URL for the latest publication.
  That publication was dated 2026-09-29 (19,444 records) and the CSV was
  5,716,625 bytes.
- Addresses sit in the remarks column as
  `Digital Currency Address - <TYPE> <address>;`. There were 96 EVM-format
  entries and 91 unique `0x` addresses, of types ETH (87), USDT (6), USDC (2)
  and ETC (1). Bitcoin, Tron and other non-`0x` types do not apply to the
  chains the app serves.
- Chainalysis's on-chain `SanctionsList` oracle at
  `0x40C57923924B5c5c5455c48D93317139ADDaC8fb` exists on Celo, Polygon and
  Ethereum, and not on Monad. Blockscout shows its last `addToSanctionsList`
  on 2026-03-18 on Celo. Of OFAC's 91 addresses, `isSanctioned(address)` returned true
  for 49 on Celo, 56 on Polygon and 58 on Ethereum, and every miss was an ETH
  entry.

## Decision

The route screens against OFAC's SDN list, loaded and cached by the app itself.
`app/api/sanctions/ofac-list.ts` downloads the CSV, collects every match of
`/Digital Currency Address - [A-Z0-9]+ (0x[0-9a-fA-F]{40})\b/g`, and lowercases,
dedupes and sorts the result. A lookup is `Set.has()` on the lowercase address,
with no per-request call to any third party.

- **Caching.** `unstable_cache` stores only the parsed address array under
  `ofac-sdn-evm-v1` and refreshes it every six hours. The CSV is fetched with
  `cache: "no-store"`, because the Vercel data cache skips items over 2 MB.
- **Guarding a bad download.** A non-2xx response, an empty body, a 30-second
  timeout, or fewer than 50 EVM addresses throws, so a truncated or reformatted
  file never replaces a good list.
- **Stale data.** In Next 16.3.5, `unstable_cache` inside a route handler
  returns a stale entry at once and refreshes it in the background; a failed
  refresh is logged and the stale entry stays
  (`dist/server/web/spec-extension/unstable-cache.js`). A missing entry is
  fetched in the foreground and a failure reaches the caller. For that case the
  module also keeps the last good list and serves it, reporting a Sentry
  warning.
- **Failing closed.** With no verified list at all, the route answers
  `502 { isSanctioned: null, error: "check_failed" }`. The fail-open switch
  and its `degraded` field are removed. A 200 is always
  `{ isSanctioned: boolean }`.
- The URL, the `isAddress` validation, the 400 and 429 answers, and the
  response contract are unchanged. `CHAINALYSIS_API_KEY` leaves the app's env
  schema.

## Alternatives considered

- **Chainalysis's on-chain oracle.** It needs no key, but it is not on Monad,
  it has not been updated since March 2026, and it misses 33 to 42 of the 91
  listed addresses depending on the chain. It cannot be the source of truth.
- **Chainalysis's paid Address Screening or Sentinel APIs.** They add a
  contract and a per-request dependency on a vendor for data that OFAC
  publishes for free, and the free API's shutdown shows the risk of that
  dependency.
- **Community mirrors of the OFAC list**, such as repositories that extract the
  crypto addresses. They add a third party between OFAC and the app with no
  guarantee of freshness or integrity.
- **Keep failing open.** Screening stays off.

## Consequences

- Screening follows OFAC within six hours of a publication, plus the time a
  background refresh takes to succeed.
- The route depends on OFAC's service being reachable when an instance has no
  cached list. Local development needs outbound access to it, and no key.
- A background refresh that fails is only logged by Next, not sent to Sentry,
  so the list can stay stale without an alert while OFAC is unreachable.
- Only the SDN list is screened. OFAC's consolidated (non-SDN) lists are not.
- The parser is tied to the CSV's remarks format. A format change trips the
  50-address floor and fails the refresh, rather than clearing wallets.
- Reverting this change would restore a dependency on a discontinued API. A
  problem with the list is fixed in the parser or the floor instead.

## Follow-ups

- Remove `CHAINALYSIS_API_KEY` from the Vercel projects, from `turbo.json`
  `passThroughEnv`, from `AGENTS.md`, and from the workflows that set it.
- Update the remaining mentions outside the app: `CLAUDE.md`'s wallet-testing
  step, `docs/vercel-deployments.md`, and the sentinel in
  `scripts/vercel-production-shadow.test.mjs`.
- Revisit whether the consolidated (non-SDN) OFAC lists need screening.

## Evidence

- `apps/app.mento.org/app/api/sanctions/ofac-list.ts`,
  `apps/app.mento.org/app/api/sanctions/route.ts` and their tests
- #994, which made the route fail open
- [OFAC Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service)
