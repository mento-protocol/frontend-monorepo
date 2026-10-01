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

- `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML`
  answers `302` with no key, to a pre-signed S3 URL for the latest publication.
  That publication was dated 2026-09-29 (19,444 records) and the XML was
  29,176,251 bytes, downloaded in about 3.3 seconds.
- Each address is an `<id>` whose `<idType>` is
  `Digital Currency Address - <TYPE>`. There were 133 EVM-format ids and 124
  unique `0x` addresses, of types ETH (120), USDT (8), USDC (2), ETC, ARB and
  BSC (1 each). `SDN_ADVANCED.XML` (127 MB) holds the same 124. Bitcoin, Tron
  and other non-`0x` types do not apply to the chains the app serves.
- The legacy `SDN.CSV` (5,716,625 bytes) is not usable. It cuts the remarks
  column, where it lists addresses, at 1000 characters: 36 rows sit at exactly
  1000, 26 of them carry addresses, and the CSV yields only 91 of the 124. It
  misses, for example, `0x9697749a9e8d6c119d8eeb0d6268a1b99c40684c` (MESRI).
- Chainalysis's on-chain `SanctionsList` oracle at
  `0x40C57923924B5c5c5455c48D93317139ADDaC8fb` exists on Celo, Polygon and
  Ethereum, and not on Monad. Blockscout shows its last `addToSanctionsList`
  on 2026-03-18 on Celo. Of OFAC's 124 addresses, `isSanctioned(address)`
  returned true for 64 on Celo, 71 on Polygon and 82 on Ethereum, and every
  miss was an ETH entry.

## Decision

The route screens against OFAC's SDN list, loaded and cached by the app itself.
`app/api/sanctions/ofac-list.ts` downloads `SDN.XML`, collects every match of
`/<idType>Digital Currency Address - [A-Z0-9]+<\/idType>\s*<idNumber>(0x[0-9a-fA-F]{40})<\/idNumber>/g`,
and lowercases, dedupes and sorts the result, with no XML library. A lookup is
`Set.has()` on the lowercase address, with no per-request call to any third
party.

- **Caching.** `unstable_cache` stores only `{ fetchedAt, addresses }` under
  `ofac-sdn-evm-v2` and refreshes it every six hours. The XML is fetched with
  `cache: "no-store"`, because the Vercel data cache skips items over 2 MB.
  Concurrent cache misses on one instance share a single download.
- **Guarding a bad download.** A non-2xx response, an empty body, a 30-second
  timeout, or fewer than 100 EVM addresses throws, so a truncated or reformatted
  file never replaces a good list. The floor would have rejected the CSV's 91.
- **Stale data.** In Next 16.3.5, `unstable_cache` inside a route handler
  returns a stale entry at once and refreshes it in the background, which
  relies on the platform's `waitUntil` to finish after the response. A failed
  refresh is only logged and the stale entry stays
  (`dist/server/web/spec-extension/unstable-cache.js`). A missing entry is
  fetched in the foreground and a failure reaches the caller; for that case the
  module keeps the last good list, serves it, and reports a Sentry warning.
  When the served list is older than three days, the route sends an
  `OFAC SDN list is stale` warning, at most once an hour per instance. That is
  the only signal of a background refresh that keeps failing.
- **Failing closed.** With no verified list at all, the route answers
  `502 { isSanctioned: null, error: "check_failed" }`. The fail-open switch
  and its `degraded` field are removed. A 200 is always
  `{ isSanctioned: boolean }`.
- The URL, the `isAddress` validation, the 400 and 429 answers, and the
  response contract are unchanged. `CHAINALYSIS_API_KEY` leaves the app's env
  schema.

## Alternatives considered

- **Chainalysis's on-chain oracle.** It needs no key, but it is not on Monad,
  it has not been updated since March 2026, and it misses 42 to 60 of the 124
  listed addresses depending on the chain. It cannot be the source of truth.
- **Chainalysis's paid Address Screening or Sentinel APIs.** They add a
  contract and a per-request dependency on a vendor for data that OFAC
  publishes for free, and the free API's shutdown shows the risk of that
  dependency.
- **OFAC's `SDN.CSV`.** It is smaller (5.7 MB), but its 1000-character remarks
  cap loses a quarter of the addresses.
- **OFAC's `SDN_ADVANCED.XML`.** It holds the same addresses in a richer
  schema, at more than four times the size.
- **Community mirrors of the OFAC list**, such as repositories that extract the
  crypto addresses. They add a third party between OFAC and the app with no
  guarantee of freshness or integrity.
- **Keep failing open.** Screening stays off.

## Consequences

- Screening follows OFAC within six hours of a publication, plus the time a
  background refresh takes to succeed.
- The route depends on OFAC's service being reachable when an instance has no
  cached list. Local development needs outbound access to it, and no key.
- A background refresh that fails is only logged by Next. The three-day stale
  warning is what surfaces an OFAC outage or a changed format.
- Each refresh downloads and scans about 29 MB, once per six hours per cache
  entry, not per request.
- Only the SDN list is screened. OFAC's consolidated (non-SDN) lists are not.
- The parser is tied to the XML's `<idType>` and `<idNumber>` layout. A format
  change trips the 100-address floor and fails the refresh, rather than
  clearing wallets. The floor needs raising as the list grows well past it.
- Reverting this change would restore a dependency on a discontinued API. A
  problem with the list is fixed in the parser or the floor instead.

## Follow-ups

- Remove `CHAINALYSIS_API_KEY` from the Vercel projects, from `turbo.json`
  `passThroughEnv`, from `AGENTS.md`, and from the workflows that set it.
- Update the remaining mentions outside the app: `docs/vercel-deployments.md`
  and the sentinel in `scripts/vercel-production-shadow.test.mjs`.
- Revisit whether the consolidated (non-SDN) OFAC lists need screening.

## Evidence

- `apps/app.mento.org/app/api/sanctions/ofac-list.ts`,
  `apps/app.mento.org/app/api/sanctions/route.ts` and their tests
- #994, which made the route fail open
- [OFAC Sanctions List Service](https://ofac.treasury.gov/sanctions-list-service)
