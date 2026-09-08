# `@metamask/jazzicon` (vendored)

Vendored copy of the `jmrossy/jazzicon` fork, pinned upstream to commit
`7a8df28974b4e81129bfbe3cab76308b889032a6` (version 2.1.0).

## Why this is vendored rather than fetched

The catalog previously pinned this dependency to
`github:jmrossy/jazzicon#7a8df28…`, which pnpm resolves to a
`codeload.github.com` tarball. Claude Code cloud sessions gate GitHub by
_repository_: every request to `github.com` and `codeload.github.com` for a
repository outside the session's scope is answered by the proxy with HTTP 403
and the body `GitHub access to this repository is not enabled for this
session`. That made `pnpm install --frozen-lockfile` fail in every cloud
session, leaving an unusable `node_modules`, and the repository is owned by a
third party so it cannot simply be added to the session's scope.

Two alternatives were rejected:

- **The published npm release.** npm only carries `@metamask/jazzicon@2.0.0`.
  This fork is `2.1.0` and was never published. The fork exists specifically to
  drop the `color` npm dependency, inlining its own hex/HSL rotation instead, so
  falling back to 2.0.0 would re-add that dependency and change the rendered
  colors — which the pixel VRT suites assert on.
- **Repointing the spec at `git+https://`.** It installs, but `scripts/lockfile-lint.mjs`
  deliberately rejects git-sourced dependencies (`GIT_REPO_ALLOWLIST` is empty by
  design) and pins the tarball exemption to the exact codeload URL so that any
  repoint fails the gate. Taking that route would mean loosening a supply-chain
  gate to work around an environment restriction.

Vendoring resolves from the workspace, so it needs no network fetch in any
environment and no lockfile-lint exemption at all. It also removes a mutable
`codeload` tarball (pinned by commit, but served without an integrity hash) from
the dependency graph; `mersenne-twister` still resolves from the npm registry
with a normal sha512.

## Contents

Only the files reachable from `index.js` are vendored:

| File        | sha256                                                             |
| ----------- | ------------------------------------------------------------------ |
| `index.js`  | `e790d3945e40cdda9a887f071948b925550e863db44362e40391d78e6b88376f` |
| `colors.js` | `8d46c8e000b6ef6dd0c790f8a9166c94f8798f9c11970eb9a6c165002cf831ae` |
| `paper.js`  | `d00d81893e08707bfa7a2b56d1a5c7e37657a03cda189d30a1fd61cae5df735d` |
| `LICENSE`   | `31ece466097a09d5226c3bbb06543d8f7b6881de291f5f0d4142daaadb30e324` |

The JavaScript is byte-for-byte upstream and must stay that way — do not
reformat or lint-fix it, so it can be diffed against upstream directly. The
upstream `addressGen.js` (unused) and `sample.js` (a browser demo requiring
`beefy`) are intentionally omitted.

To verify against upstream:

```bash
git clone https://github.com/jmrossy/jazzicon /tmp/jazzicon
git -C /tmp/jazzicon checkout 7a8df28974b4e81129bfbe3cab76308b889032a6
diff /tmp/jazzicon/index.js packages/jazzicon/index.js
```

## Updating

Re-copy the files from the new upstream commit, refresh the commit hash and the
checksums above, and re-record the `@mento-protocol/ui` DOM snapshots plus the
Argos pixel baselines if the rendered identicons change.
