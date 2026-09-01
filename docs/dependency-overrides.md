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
root workspace. Its `pnpm.overrides` object must remain deeply equal to the
root `package.json` object. The standalone package must also pin the exact
Vercel CLI version and every Vercel builder peer as a direct dependency. This
keeps protected frozen installs inside the reviewed registry-only lockfile.

The workspace and standalone runtime resolve legacy v2 consumers to upstream
`brace-expansion@2.1.4`. The August 2026 rotation retired the former local
2.1.2 patch. The checked-in manifests, lockfiles, contract, and validators use
only the exact reviewed nanoid 3.3.18 pair. Do not restore a retired patch or
cross-paired manifest and lockfile state.

The scheduled no-exec agent must classify every protected-runtime rotation as
`manual`. This includes Next.js, the Vercel CLI, and the protected pnpm runtime
and bootstrap. It must not run a metadata query, package-manager command,
generator, install, test, build, or smoke command from this procedure. The
generic external agent must not prepare or push this rotation, even when it has
an `execute` grant. An authenticated maintainer takes over the branch outside
the generic skill. Keep all coupled files in one pull request. If any step or
validator cannot be completed, keep the update `manual`. Do not restore an old
workspace version only to make the protected-runtime check pass.

The checked-in validators prove candidate self-consistency and the expected
registry-only runtime shape. They do not prove that candidate-authored metadata
came from the public npm registry. They also do not prove that a generated root
lockfile preserved every unrelated source entry. The maintainer must establish
those two facts independently before push.

### Protected pnpm runtime rotation

Use this path when the root `packageManager`, protected Vercel pnpm runtime, or
Linux bootstrap must move.

1. Review the upstream advisory and release. Fetch the exact public npm version
   documents for `pnpm` and `@pnpm/linux-x64`. Bind their bytes and digests to
   the review record. For `pnpm`, require the exact name, version, npmjs tarball
   host, integrity, Node engine, and binary map. For `@pnpm/linux-x64`, require
   the exact name, version, npmjs tarball host, integrity, binary map,
   `os: ["linux"]`, and `cpu: ["x64"]`. Reject a redirect, prerelease,
   downgrade, or unexplained metadata change.
2. Move the root package-manager declaration, Action setup pins, protected
   runtime checks, bootstrap checks, controller constants, and their tests to
   the same exact version. Update only the one-package pnpm lock and bootstrap
   npm lock entries with the reviewed public registry URLs and integrities.
   Recompute the extracted Linux executable SHA-256 and the byte SHA-256 of both
   regenerated locks. Review and update
   `PINNED_PNPM_LINUX_X64_SHA256`,
   `PINNED_PNPM_BOOTSTRAP_LOCKFILE_SHA256`, and
   `PINNED_PNPM_RUNTIME_LOCKFILE_SHA256`.
3. Remove an obsolete OSV exception only after the exact target lock passes
   without it. Do not add an exception for an active advisory. Update the
   lockfile lint advisory floors so the replaced vulnerable release cannot
   return. Require the exact-head
   `osv-scanner (trusted pnpm runtime) / osv-scan` CI job to pass with
   no ignored vulnerability.
4. Review every changed path. Run the full protected pnpm validation:

   ```bash
   pnpm dependency:policy:test
   pnpm ci:action-pins:test
   pnpm ci:action-pins
   pnpm supply-chain:lockfile-lint:test
   pnpm supply-chain:lockfile-lint
   pnpm supply-chain:version-skew
   pnpm vercel:versions:check
   pnpm vercel:production-shadow:test
   pnpm vercel:workflow:test
   ```

### Vercel CLI rotation

Use this path for every Vercel CLI update, including a routine same-major patch
or minor release.

1. Review the target release and its exact public npm metadata. Reject a
   prerelease, downgrade, unknown registry source, or unexplained builder peer
   change. Update the root `devDependencies.vercel` pin and root lockfile.
2. Read the target release's builder peer map from npm. Review every key and
   major-version change. Set the standalone runtime dependencies to that exact
   peer map plus the exact target `vercel` version. Copy the complete root
   `pnpm.overrides` object into the standalone manifest. Fetch the exact version
   document directly from `https://registry.npmjs.org`. Bind its bytes and
   digest to the review record. Require the expected package name, version,
   tarball host, integrity, peer map, optional-peer map, Node engine, and binary
   shape. Reject registry redirection or missing fields.

3. Regenerate only the standalone lockfile from a fresh isolated directory.
   Use the repository's exact pnpm 10.34.5. Disable lifecycle scripts,
   pnpmfile loading, and workspace discovery. Use an empty temporary home and
   user configuration. Set the registry explicitly to
   `https://registry.npmjs.org/`. Reject `configDependencies`, hooks, patches,
   workspace links, or another package-manager extension before generation.
   Verify the pnpm executable and exact version before it reads the candidate.

4. Review the root and standalone lockfile diffs. Update
   `scripts/vercel-cli-runtime/contract.json` with the target Vercel version,
   exact registry integrity, runtime manifest digest, runtime dependency-map
   digest, standalone lockfile digest, and root override-map digest. Change no
   contract key or schema.
5. Run the validators below. Review their failure before changing a contract
   value. Compute every digest from the reviewed bytes. Do not guess a value
   only to silence a failed check.

### Next.js catalog and override rotation

Every Next.js update must move all four coupled states together:

- the `next` catalog entry in `pnpm-workspace.yaml`;
- the root `package.json` `pnpm.overrides.next` entry;
- the full override mirror in `scripts/vercel-cli-runtime/package.json`; and
- the standalone runtime contract and lockfile.

Use the same caret specifier for the catalog and both override maps. Preserve
workspace `catalog:` references. Then:

1. Start from the live Dependabot or maintainer branch. Review the requested
   Next.js release, migration notes, peer ranges, engines, and lockfile closure.
   Fetch the exact public npm version documents for `next`, `@next/env`, each
   platform SWC package, and each changed runtime dependency. Bind their bytes
   and digests to the review record. Verify integrity, peer maps, optional-peer
   metadata, engines, and the retained snapshot peer context.
2. Update the catalog and root override. Generate the target closure in a clean
   disposable directory with exact pnpm 10.34.5, an empty temporary home and
   user configuration, the explicit public registry, disabled lifecycle
   scripts, and disabled pnpmfile loading. Reject `configDependencies`, hooks,
   patches, or another package-manager extension before generation. Import only
   the requested Next.js runtime closure into the source root lockfile. Preserve
   every unrelated source byte and resolution. Reject a wholesale rewrite.

3. Copy the complete root override map into the standalone manifest. Regenerate
   the standalone lockfile with the isolated command from the Vercel procedure.
   The Vercel version, builder dependency map, and Vercel registry integrity
   must remain unchanged unless the pull request also contains an independently
   reviewed Vercel rotation.
4. Update only the affected digest fields in
   `scripts/vercel-cli-runtime/contract.json`. Keep its Vercel identity fields
   unchanged for a Next-only rotation.
5. Review the final diff. It may contain the requested workspace declarations,
   root lockfile, root override, standalone manifest and lockfile, and runtime
   contract. Explain every additional path before push.

### Protected-runtime validation

After generation, compare each output with the recorded source bytes. For a
Vercel-only rotation, permit only the exact Vercel regions in the root lockfile.
For a Next.js rotation, permit only the exact target runtime closure. Reject an
unrelated key, resolution, integrity, snapshot, override, patch, or metadata
change. Compute each contract digest from the final reviewed bytes. Do not copy
a candidate-provided digest without recomputing it.

The commands below validate the checked-in candidate. They are necessary, but
they do not replace the public-registry provenance and source-bound lockfile
comparison above.

Run all of these commands after a Next.js or Vercel CLI rotation:

```bash
pnpm dependency:policy:test
pnpm supply-chain:version-skew
pnpm supply-chain:lockfile-lint
pnpm vercel:versions:check
pnpm vercel:production-shadow:test
pnpm vercel:workflow:test
```

Run a frozen root install and the affected application build for a Next.js
rotation. Run a fresh secretless standalone install and exact
`node <vercel-cli> --version` smoke for a Vercel rotation. The maintainer then
follows the normal exact-head review and merge gates. The generic
`dependabot-prep` agent reports this pull request as `manual`.

Never run a general workspace install to regenerate the standalone lockfile.
That can admit workspace links into a runtime whose isolation depends on a
standalone registry-only graph.

### Reviewed brace-expansion state

The root and standalone manifests now require upstream fixed
`brace-expansion@2.1.4` for v2 consumers and `5.0.9` for v5 consumers. Neither
manifest declares a local patch. The lockfile lint rejects patched-dependency
metadata and every affected release, including pnpm aliases, so a broad OSV
correction cannot hide a future direct or aliased vulnerable entry.

The active contract and validators admit only the patchless nanoid 3.3.18
pair. They reject the former pair, either cross-paired hybrid, and unreviewed
state. Retired patch metadata remains only in negative regression fixtures; do
not restore the patch to either manifest.

## Wormhole Connect (`@wormhole-foundation/wormhole-connect`)

`app.mento.org` uses Wormhole Connect only for the `/bridge` route. The widget
UI is lazy-loaded in `apps/app.mento.org/app/components/bridge/bridge-view.tsx`
with `next/dynamic` and `ssr: false`, so the UI package should not enter the
shared application bundle. The route config in
`apps/app.mento.org/app/components/bridge/bridge-config.ts` also imports the
`@wormhole-foundation/wormhole-connect/ntt` subpath; that value import belongs
to the bridge route chunk.

Wormhole's [v5 to v6 migration guide](https://wormhole.com/docs/products/connect/guides/upgrade/#v5-to-v6)
lists `nttRoutes` as unchanged. This integration uses
`nttRoutes(nttConfig)` and neither imports a removed automatic route nor matches
legacy route-name strings, so the major upgrade needs no bridge source changes.
The helper continues to supply the NTT manual and Executor routes.

The report-only CSP records the bridge's reviewed runtime egress in
`apps/app.mento.org/app-report-only-csp.mjs`. Wormhole Connect and its route
SDKs use `li.quest` for transfer analytics, `explorer-api.mayan.finance` for
Mayan swap status, and `executor.labsapis.com` for NTT transaction status.
Keep those entries exact and app-local. Do not authorize dependency-default RPC
origins for chains outside the configured Celo, Monad, and Polygon routes.

Wormhole Connect 6.0.0 owns its MUI, Emotion, and Lucide dependencies.
`app.mento.org` therefore does not declare MUI or Emotion packages solely for
the widget, and Mento source must not import those packages directly. Keep that
UI framework isolated to the lazy-loaded bridge route.

The app separately uses the catalog's reviewed Lucide 1.x release. The widget
resolves its own `^0.554.0` direct dependency, so the former
`peerDependencyRules.allowedVersions` exception is no longer necessary. Do not
force either Lucide version across the incompatible major ranges.

As of the September 2026 renewal, `osv-scanner.toml` has 21 ignored
vulnerability blocks, and 11 blocks document the Wormhole Connect dependency
chain. That cluster is protobufjs including `@protobufjs/utf8`. Axios, valibot,
ip-address, and uuid are no longer suppressed because reviewed override floors
resolve fixed releases. Do not attribute the elliptic, bigint-buffer,
decode-uri-component, or Metro-only image-size suppressions to Wormhole; their
documented chains are separate.

## When an override is the wrong instrument

A range-scoped floor only works when the fixed release is drop-in for the
consumers already in the tree. Check the module format before adding one: if
the fixed release is ESM-only and a CommonJS consumer `require()`s it, the
override resolves cleanly, installs cleanly, and then throws
`TypeError: <name> is not a function` at runtime, because `require()` of an ESM
module yields the namespace object rather than the default export.

`decode-uri-component` (GHSA-vcc3-ghjq-m6fr) is the worked example. Its only
fixed release, 0.5.0, is ESM-only; its only consumer, `query-string@7.1.3`
under `@walletconnect/utils`, is CommonJS and requires it. Upgrading
`query-string` does not help either — every release through 9.5.0 still depends
on an affected `decode-uri-component@^0.4.1`, and 8.x+ is ESM-only. The
suppression in `osv-scanner.toml` records that analysis and the two remaining
real fixes (`pnpm patch` the backport, or wait for WalletConnect to drop
query-string 7.x). Verify a proposed floor against the consumer's module system
before you add it, not after the preview breaks.

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
