# Dependency overrides

`package.json`'s `pnpm.overrides` block rewrites **every** specifier for a
package name, including `catalog:` references in workspace member manifests.
That makes it a second source of truth for dependency versions, alongside the
`catalog:` block in `pnpm-workspace.yaml` — see the
[Dependency Management with PNPM Catalog](../README.md#dependency-management-with-pnpm-catalog)
section of the README for how the catalog itself works.

`scripts/version-skew-check.mjs` (run via `pnpm supply-chain:version-skew`)
fails the build if an unconditional override targets a cataloged package with
a version string that doesn't match the catalog exactly. Keeping the two in
sync is a requirement, not a suggestion — a catalog bump for an overridden
package is silently defeated otherwise (this happened to `zod`; see the table
below).

## Wormhole Connect (`@wormhole-foundation/wormhole-connect`)

`app.mento.org` uses Wormhole Connect only for the `/bridge` route. The widget
UI is lazy-loaded in `apps/app.mento.org/app/components/bridge/bridge-view.tsx`
with `next/dynamic` and `ssr: false`, so the UI package should not enter the
shared application bundle. The route config in
`apps/app.mento.org/app/components/bridge/bridge-config.ts` also imports the
`@wormhole-foundation/wormhole-connect/ntt` subpath; that value import belongs
to the bridge route chunk.

The app declares `@mui/icons-material`, `@mui/material`,
`@mui/styled-engine`, `@mui/system`, `@emotion/react`, and `@emotion/styled`
only to satisfy Wormhole Connect peer ranges. There are no direct TypeScript,
TSX, or app config imports of those packages in `apps/app.mento.org`. Do not
remove them independently, and do not start using them directly in Mento UI
code.

As of the 2026-07-10 check for issue #418, `osv-scanner.toml` has 74 ignored
vulnerability blocks, and 15 blocks mention the Wormhole Connect dependency
chain in the reason or surrounding comments. That cluster is currently axios
(3 blocks), protobufjs including `@protobufjs/utf8` (11 blocks), and uuid (1
block). Do not attribute the elliptic or bn.js suppressions to Wormhole; their
documented chains are separate.

Removing Wormhole Connect is intentionally out of scope for this document. At
the next quarterly dependency review, check `/bridge` traffic in Vercel
Analytics for the `app.mento.org` project. Record the review date and traffic
figure on the tracking issue; if traffic is near zero, open a dedicated removal
proposal before changing dependencies.

## Range-scoped entries need no row here

Most entries in `pnpm.overrides` are range-scoped CVE floors, e.g.:

```json
"axios@<1.15.0": ">=1.15.0"
```

`brace-expansion` is also conditional: `"brace-expansion@<2.0.2": "2.0.3"`
only rewrites vulnerable versions below `2.0.2`. Remove it once
`pnpm why -r brace-expansion` shows that every consumer resolves a patched
version without the override.

These self-expire: once every dependency graph naturally resolves a version
inside the target range, the override becomes a no-op and can be deleted
without changing the lockfile. They don't conflict with the catalog checker
either — the checker only compares unconditional (bare-name) override keys
against the catalog, since a `pkg@<range>` selector can never equal a plain
catalog key.

The table below covers only the **unconditional** overrides: a bare package
name (or a scoped name, e.g. `@tanstack/react-query`) with no `@<selector>`
suffix. These don't self-expire — they need a human to notice when the reason
no longer applies.

## Unconditional overrides

| Override                | Reason                                                                                                                                                                                                                                                                                | Added in                                                                                          | Removal condition                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tanstack/query-core`  | Dedupe/pin alongside `@tanstack/react-query` — `query-core` must match the pinned `react-query` version.                                                                                                                                                                              | `92facd3` (PR #356)                                                                               | Same condition as `@tanstack/react-query` below — bump both together.                                                                                                     |
| `@tanstack/react-query` | Compatibility pin. Releases past `5.90.16` caused a production QueryClient context split in `app.mento.org` (see README).                                                                                                                                                             | `54e1ee6`, version pinned to exact `5.90.16` in `92facd3` (PR #356)                               | Once a newer release is production-built and browser-verified on the swap and pools routes (README), bump the catalog and this override together.                         |
| `esbuild`               | Pin a patched `esbuild` for production build safety.                                                                                                                                                                                                                                  | `793a187` (as a floor), tightened to an exact pin in `92facd3` (PR #356)                          | Once the transitive `esbuild` resolved by the build toolchain (tsup, vite, etc.) is `>=0.28.1` by default.                                                                |
| `linkifyjs`             | CVE fix pin.                                                                                                                                                                                                                                                                          | `2e80017`                                                                                         | Once transitive consumers resolve `>=4.3.2` by default.                                                                                                                   |
| `mdast-util-to-hast`    | CVE fix pin (npm vulnerability batch).                                                                                                                                                                                                                                                | `ca3dd7e`                                                                                         | Once transitive consumers resolve the patched version by default.                                                                                                         |
| `next`                  | Keeps every `next` consumer (including tooling with its own dependency graph) aligned with the catalog version — not a CVE patch.                                                                                                                                                     | `6032e90`, kept in step with the catalog through `6d93f3c`/`92facd3`                              | Not removable while the catalog also pins `next`; this override exists to catch drift, so keep its value textually identical to `pnpm-workspace.yaml`'s `next` entry.     |
| `picomatch`             | CVE fix pin.                                                                                                                                                                                                                                                                          | `68218a2` (PR #301)                                                                               | Once transitive consumers resolve `>=4.0.4` by default.                                                                                                                   |
| `preact`                | CVE fix, minimum patched version.                                                                                                                                                                                                                                                     | `a446eb6`                                                                                         | Once transitive consumers resolve `>=10.28.2` by default.                                                                                                                 |
| `shell-quote`           | CVE fix ("override vulnerable shell quote").                                                                                                                                                                                                                                          | `92facd3` (PR #356)                                                                               | Once transitive consumers resolve `>=1.8.4` by default.                                                                                                                   |
| `tmp`                   | CVE fix (arbitrary file write).                                                                                                                                                                                                                                                       | `fd7abd6`                                                                                         | Once transitive consumers resolve `>=0.2.4` by default.                                                                                                                   |
| `wagmi`                 | Keeps every `wagmi` consumer aligned with the catalog version — not a CVE patch.                                                                                                                                                                                                      | `54e1ee6`, version bumped in `6032e90`                                                            | Not removable while the catalog also pins `wagmi`; keep its value textually identical to `pnpm-workspace.yaml`'s `wagmi` entry.                                           |
| `zod`                   | Dedupe. Without this override, `pnpm install` resolves four separate zod majors (`3.22.4`, `3.25.76`, `4.3.5`, `4.4.3`) across the `viem`/`ox`/`abitype`/`@coinbase/cdp-sdk` peer trees, since those accept both zod 3 and zod 4. Forcing one copy avoids that split. See issue #409. | `d0f940c`, value reconciled to the catalog string (`^4.4.3`) in the #409 catalog/override cleanup | Once `pnpm why -r zod` shows every consumer converging on zod 4.x on its own (no dependency still requiring zod 3.x), drop the override and let the catalog alone govern. |

## Provenance methodology

Reasons and "added in" commits above were reconstructed with:

```bash
git log -S '"<override-name>"' --oneline -- package.json
```

Cross-check any future addition/removal against this table so it doesn't go
stale — a new unconditional override needs a new row here in the same PR.
