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

## Standalone Vercel CLI override mirror

The protected production-shadow and automatic main-deployment jobs install
Vercel from the standalone `scripts/vercel-cli-runtime` package instead of the
root workspace. Its
`pnpm.overrides` object must remain deeply equal to the root
`package.json` object so the protected CLI receives the same security
resolutions. It must pin that exact Vercel version plus every Vercel CLI builder
peer as a direct dependency, so protected frozen installs never fetch builders
outside the reviewed lockfile.

The workspace and standalone runtime resolve legacy v2 consumers to upstream
`brace-expansion@2.1.4`. The August 2026 rotation retired the former local 2.1.2
patch. The checked-in manifests, lockfiles, and trusted controller now use only
the exact reviewed nanoid 3.3.18 pair. The controller rejects the former pair,
cross-paired hybrids, and unreviewed lockfile or override state.

After changing the root Vercel pin or any root override, update this protected
runtime in the same PR:

1. Mirror the root Vercel pin and complete override object into the standalone
   manifest. If the Vercel version changed, also update
   `PINNED_VERCEL_CLI_VERSION` in
   `scripts/vercel-cli-runtime-contract.mjs`; the Vercel workflow structural
   tests identify every remaining reviewed version assertion that must change:

   ```bash
   node --input-type=module -e '
   import { readFile, writeFile } from "node:fs/promises";
   const root = JSON.parse(await readFile("package.json", "utf8"));
   const path = "scripts/vercel-cli-runtime/package.json";
   const runtime = JSON.parse(await readFile(path, "utf8"));
   runtime.dependencies.vercel = root.devDependencies.vercel;
   runtime.pnpm.overrides = root.pnpm.overrides;
   await writeFile(path, `${JSON.stringify(runtime, null, 2)}\n`);
   '
   ```

2. Regenerate only the standalone lockfile from a fresh isolated directory:

   ```bash
   runtime_dir="$(mktemp -d)"
   cp scripts/vercel-cli-runtime/package.json "$runtime_dir/package.json"
   CI=true pnpm --dir "$runtime_dir" install --lockfile-only --ignore-scripts
   mv "$runtime_dir/pnpm-lock.yaml" scripts/vercel-cli-runtime/pnpm-lock.yaml
   rm -rf "$runtime_dir"
   ```

3. Review the lockfile diff and calculate its exact digest:

   ```bash
   shasum -a 256 scripts/vercel-cli-runtime/pnpm-lock.yaml
   ```

   For a future rotation, change the manifest and lockfile state in a three-PR
   sequence. First, land a trusted default-branch controller change that maps
   each reviewed current/next
   lockfile digest to the SHA-256 of its matching canonical, sorted root
   override object. The standalone manifest must remain an exact mirror of
   that root state, and cross-paired old-lock/new-manifest or
   new-lock/old-manifest hybrids must reject. Candidate or PR-authored source
   must never supply or extend this mapping. Then land the matching manifest
   and lockfile state in a second PR, keeping the manifest's exact Vercel pin
   and all registry-only checks intact. Immediately after that PR merges, use
   a third cleanup PR to remove the former digest/override pair and restore the
   single-pair contract.

4. Verify the root/standalone pins, exact manifest, override mirror, reviewed
   lockfile digest, and registry-only lockfile policy:

   ```bash
   pnpm vercel:versions:check
   pnpm vercel:production-shadow:test
   pnpm vercel:workflow:test
   pnpm supply-chain:lockfile-lint
   ```

Never run a general workspace install to regenerate this lockfile. That would
allow workspace links into a runtime whose isolation depends on a standalone
registry-only graph.

### Reviewed brace-expansion state

The root and standalone manifests now require upstream fixed
`brace-expansion@2.1.4` for v2 consumers and `5.0.9` for v5 consumers. Neither
manifest declares a local patch. The lockfile lint rejects patched-dependency
metadata and every affected release, including pnpm aliases, so a broad OSV
correction cannot hide a future direct or aliased vulnerable entry.

The controller's default contract contains only the active patchless nanoid
3.3.18 pair. It rejects the former pair, either cross-paired hybrid, and
unreviewed state. Retired patch metadata remains only in negative regression
fixtures; do not restore the patch to either manifest.

## Wormhole Connect (`@wormhole-foundation/wormhole-connect`)

`app.mento.org` uses Wormhole Connect only for the `/bridge` route. The widget
UI is lazy-loaded in `apps/app.mento.org/app/components/bridge/bridge-view.tsx`
with `next/dynamic` and `ssr: false`, so the UI package should not enter the
shared application bundle. The route config in
`apps/app.mento.org/app/components/bridge/bridge-config.ts` also imports the
`@wormhole-foundation/wormhole-connect/ntt` subpath; that value import belongs
to the bridge route chunk.

The report-only CSP records the bridge's reviewed runtime egress in
`apps/app.mento.org/app-report-only-csp.mjs`. Wormhole Connect and its route
SDKs use `li.quest` for transfer analytics, `explorer-api.mayan.finance` for
Mayan swap status, and `executor.labsapis.com` for NTT transaction status.
Keep those entries exact and app-local. Do not authorize dependency-default RPC
origins for chains outside the configured Celo, Monad, and Polygon routes.

The app declares `@mui/icons-material`, `@mui/material`,
`@mui/styled-engine`, `@mui/system`, `@emotion/react`, and `@emotion/styled`
only to satisfy Wormhole Connect peer ranges. There are no direct TypeScript,
TSX, or app config imports of those packages in `apps/app.mento.org`. Do not
remove them independently, and do not start using them directly in Mento UI
code.

As of the August 2026 remediation, `osv-scanner.toml` has 20 ignored
vulnerability blocks, and 11 blocks document the Wormhole Connect dependency
chain. That cluster is protobufjs including `@protobufjs/utf8`. Axios, valibot,
ip-address, and uuid are no longer suppressed because reviewed override floors
resolve fixed releases. Do not attribute the elliptic, bigint-buffer, or
Metro-only image-size suppressions to Wormhole; their documented chains are
separate.

Removing Wormhole Connect is intentionally out of scope for this document. At
the next quarterly dependency review, check `/bridge` traffic in Vercel
Analytics for the `app.mento.org` project. Record the review date and traffic
figure on the tracking issue; if traffic is near zero, open a dedicated removal
proposal before changing dependencies.

## Range-scoped entries need no row here

Most entries in `pnpm.overrides` are range-scoped CVE floors, e.g.:

```json
"axios@<1.18.0": ">=1.18.0"
```

`brace-expansion` has two conditional floors: `"brace-expansion@<2.1.4":
"2.1.4"` upgrades legacy v2 consumers to the upstream fixed release, and
`"brace-expansion@>=5 <5.0.9": "5.0.9"` upgrades vulnerable native v5
consumers. Remove each range override once `pnpm why -r brace-expansion` shows
its affected consumers resolving a fixed version without the override.

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
| `@mysten/sui`           | Pins the Sui SDK release selected by the July 2026 OSV remediation.                                                                                                                                                                                                                   | `ddf02828`                                                                                        | Remove when all transitive Sui consumers converge on a safe release without a root-wide pin.                                                                              |
| `@tanstack/query-core`  | Dedupe/pin alongside `@tanstack/react-query` — `query-core` must match the pinned `react-query` version.                                                                                                                                                                              | `92facd3` (PR #356)                                                                               | Same condition as `@tanstack/react-query` below — bump both together.                                                                                                     |
| `@tanstack/react-query` | Compatibility pin. Releases past `5.90.16` caused a production QueryClient context split in `app.mento.org` (see README).                                                                                                                                                             | `54e1ee6`, version pinned to exact `5.90.16` in `92facd3` (PR #356)                               | Once a newer release is production-built and browser-verified on the swap and pools routes (README), bump the catalog and this override together.                         |
| `esbuild`               | Pin a patched `esbuild` for production build safety.                                                                                                                                                                                                                                  | `793a187` (as a floor), tightened to an exact pin in `92facd3` (PR #356)                          | Once the transitive `esbuild` resolved by the build toolchain (tsup, vite, etc.) is `>=0.28.1` by default.                                                                |
| `linkifyjs`             | CVE fix pin.                                                                                                                                                                                                                                                                          | `2e80017`                                                                                         | Once transitive consumers resolve `>=4.3.2` by default.                                                                                                                   |
| `mdast-util-to-hast`    | CVE fix pin (npm vulnerability batch).                                                                                                                                                                                                                                                | `ca3dd7e`                                                                                         | Once transitive consumers resolve the patched version by default.                                                                                                         |
| `next`                  | Keeps every `next` consumer (including tooling with its own dependency graph) aligned with the catalog version — not a CVE patch.                                                                                                                                                     | `6032e90`, kept in step with the catalog through `6d93f3c`/`92facd3`                              | Not removable while the catalog also pins `next`; this override exists to catch drift, so keep its value textually identical to `pnpm-workspace.yaml`'s `next` entry.     |
| `picomatch`             | CVE fix pin.                                                                                                                                                                                                                                                                          | `68218a2` (PR #301)                                                                               | Once transitive consumers resolve `>=4.0.4` by default.                                                                                                                   |
| `preact`                | CVE fix, minimum patched version.                                                                                                                                                                                                                                                     | `a446eb6`                                                                                         | Once transitive consumers resolve `>=10.28.2` by default.                                                                                                                 |
| `shell-quote`           | CVE fix ("override vulnerable shell quote").                                                                                                                                                                                                                                          | `92facd3` (PR #356)                                                                               | Once transitive consumers resolve `>=1.9.0` by default.                                                                                                                   |
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
