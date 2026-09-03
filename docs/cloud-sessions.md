# Claude Code on the web — environment notes

Findings from the first cloud sessions for this repository. A cloud session runs
in an ephemeral container with a fresh clone, and all outbound HTTPS goes
through a policy-enforcing egress proxy. Nothing is installed unless a setup
script installs it, and there is no setup script configured today, so
`node_modules` is empty at session start.

Everything here was observed, not inferred. That distinction earned its keep:
of the three things that broke, only one was actually the egress allowlist, and
the other two look identical from the outside.

## The three failure classes

A `403` tells you almost nothing on its own — three different systems in this
environment return one. Identify which before trying to fix anything:

| Symptom                                                                         | Cause                                         | Fixed by               |
| ------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------- |
| `curl: (56) CONNECT tunnel failed, response 403`, host in `recentRelayFailures` | Egress allowlist                              | Allowlisting the host  |
| HTTP `403` with a JSON body naming `add_repo`                                   | The session's GitHub repo-access lane         | **Nothing** — see §2   |
| HTTP `403` only from Node, while `curl` to the same URL returns `200`           | `global.fetch` (undici) ignores `HTTPS_PROXY` | `NODE_USE_ENV_PROXY=1` |

The first is the only one the allowlist governs. Diagnose it with the proxy's
own log, never with the exit code alone:

```bash
curl -sS "$HTTPS_PROXY/__agentproxy/status" | jq .recentRelayFailures
```

A rejected CONNECT is recorded there. If the host is absent from that list but
you still got a 403, it came from the origin or from the GitHub lane, and
widening the allowlist will not help.

## 1. Egress allowlist — resolved

The hosts this repository needs are now reachable. Verified by probing each one
and confirming an established tunnel:

`codeload.github.com`, `trunk.io`, `api.trunk.io`, `foundry.paradigm.xyz`,
`forno.celo.org`, `forno.celo-sepolia.celo-testnet.org`, `celo.drpc.org`,
`celo.rpc.thirdweb.com`, `celo.blockscout.com`, `rpc.ankr.com`, `celoscan.io`,
`api.celoscan.io`, `sepolia.celoscan.io`, `rpc.monad.xyz`,
`testnet-rpc.monad.xyz`, `rpc3.monad.xyz`, `monad.drpc.org`, `monadscan.com`,
`testnet.monadscan.com`, `gateway.thegraph.com`, `api.studio.thegraph.com`,
`public.chainalysis.com`, `api.vercel.com`, `openapi.vercel.sh`,
`api.argos-ci.com`, `sentry.io`.

Allowlist changes apply to **already-running** sessions, so there is no need to
start a new one to test them — re-probe from the session you are in.

`telemetry.vercel.com` is deliberately not allowlisted. It 403s on every
`next build` and `next typegen`, which is harmless but fills
`recentRelayFailures` and makes the log useless for real diagnosis. Set
`NEXT_TELEMETRY_DISABLED=1` instead.

## 2. GitHub source archives are not served, and the allowlist cannot fix it

Two things still fail, for one shared reason. Both return this:

```json
{
  "message": "GitHub access to this repository is not enabled for this session. Use add_repo to request access."
}
```

That is the session's GitHub repo-access gate, not the egress proxy — the host
never appears in `recentRelayFailures`. It applies to GitHub's
**source-archive endpoints**:

- `https://codeload.github.com/<owner>/<repo>/tar.gz|zip/<ref>`
- `https://github.com/<owner>/<repo>/archive/<ref>.zip`
- `https://api.github.com/repos/<owner>/<repo>/tarball/<ref>`

**Git protocol reads are served, for any public repository.** `git clone`,
`git fetch`, and `git ls-remote` over HTTPS all work anonymously. `add_repo`
confirms this explicitly and attaches nothing: read access "is already
available … this session's git proxy serves anonymous git reads of public
GitHub repositories directly." So the split is by _protocol_, not by
repository: git yes, archive tarballs no. Calling `add_repo` does not change
it.

### 2a. `pnpm install`

```text
ERR_PNPM_FETCH_403  GET https://codeload.github.com/jmrossy/jazzicon/tar.gz/7a8df28…: Forbidden - 403
```

The repository has exactly one git-hosted dependency, in the
`pnpm-workspace.yaml` catalog:

```yaml
"@metamask/jazzicon": github:jmrossy/jazzicon#7a8df28974b4e81129bfbe3cab76308b889032a6
```

pnpm resolves a `github:` specifier to a codeload tarball, so the install dies
after resolving all 2547 packages. The failure mode is nasty: `.pnpm/` fills up
but the workspace links are never created, so it reads as a _successful_
install followed by every import being missing. Check `ls node_modules | wc -l`
at the root, not just the exit code.

Session workaround — point the catalog at the git protocol, which _is_ served,
then restore both files:

```bash
cp pnpm-workspace.yaml /tmp/ws.bak && cp pnpm-lock.yaml /tmp/lock.bak
sed -i 's|github:jmrossy/jazzicon#|git+https://github.com/jmrossy/jazzicon.git#|' pnpm-workspace.yaml
pnpm install --no-frozen-lockfile      # ~46s, succeeds
cp /tmp/ws.bak pnpm-workspace.yaml && cp /tmp/lock.bak pnpm-lock.yaml
```

`node_modules` keeps the package and `git status` comes back clean. Do **not**
commit the rewritten specifier or the lockfile it produces.

A permanent fix would be to change the catalog to the `git+https://` form for
everyone. pnpm supports it, it resolves the same commit, and it is not a
supply-chain regression — the current codeload entry carries
`{gitHosted: true, tarball: …}` with no integrity hash either. But it rewrites
`pnpm-lock.yaml` in a repository with lockfile-integrity gates, so it is a
maintainer's call, not a session's.

### 2b. Trunk's linter plugins

```text
✖ Unable to download plugin https://github.com/trunk-io/plugins/archive/v1.7.3.zip: HTTP 403
```

Same gate, same shape. Workaround: clone the pinned tag over git and point
`.trunk/trunk.yaml` at the local copy instead of the remote URI.

```bash
git clone --depth 1 --branch v1.7.3 https://github.com/trunk-io/plugins /opt/trunk-plugins
```

```yaml
plugins:
  sources:
    - id: trunk
      local: /opt/trunk-plugins # instead of ref: + uri:
```

That edit is environment-specific and must not be committed. Which is the real
argument for §5: bake trunk and its plugins into the image so no session has to
do any of this.

## 3. Node's `fetch` ignores the proxy

Trunk's own binary download failed with `HTTP 403 Forbidden` even after
`trunk.io` was allowlisted, while `curl` to the identical URL returned `200`
and a checksum-matching 12.7 MB tarball. The launcher uses `global.fetch`, and
Node's undici does not read `HTTPS_PROXY`.

```bash
$ node -e "fetch('https://trunk.io/releases/latest').then(r=>console.log(r.status))"
403
$ NODE_USE_ENV_PROXY=1 node -e "fetch('https://trunk.io/releases/latest').then(r=>console.log(r.status))"
200
```

`NODE_USE_ENV_PROXY=1` makes undici honour the proxy environment (via
`EnvHttpProxyAgent`; it warns that it is experimental, harmlessly). With it,
`npx @trunkio/launcher --version` prints `1.25.0`.

**Set `NODE_USE_ENV_PROXY=1` in the environment.** It costs nothing and fixes
this whole class for any tool that reaches the network through `fetch` rather
than a proxy-aware client. It is not needed for this repository's own scripts —
`scripts/fork-seed.mjs` and `scripts/fork-seed-monad.mjs` use `fetch`, but only
against the local anvil fork on `localhost`, which bypasses the proxy anyway.

## 4. Missing tooling

| Tool                                                 | Present | Needed for                                                        |
| ---------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `node` 22.22.2, `pnpm` 10.34.5                       | yes     | everything                                                        |
| `docker`, `jq`, `unzip`, `python3`, `go`             | yes     | —                                                                 |
| Chromium + Playwright browsers at `/opt/pw-browsers` | yes     | VRT and E2E                                                       |
| `anvil`, `cast`, `forge` (Foundry)                   | **no**  | `pnpm fork:mainnet`, `fork:monad`, and every connected-wallet E2E |
| `trunk`                                              | **no**  | lint/format — installable now, see §3 and §5                      |
| `gh`                                                 | **no**  | not needed — use the GitHub MCP tools                             |

`foundry.paradigm.xyz` is allowlisted, so `foundryup` can install Foundry; the
setup script has to actually run it. Foundry plus the RPC hosts are both
required before any wallet-connected E2E work can run. Neither is needed for
workflow, script, or unit-test work.

## 5. Suggested setup script

```bash
#!/usr/bin/env bash
set -euo pipefail

export NEXT_TELEMETRY_DISABLED=1
# §3 — undici ignores HTTPS_PROXY without this.
export NODE_USE_ENV_PROXY=1

# §2a — the github: catalog entry resolves to a codeload tarball, which this
# session's GitHub lane does not serve. Rewrite to the git protocol, install,
# and restore, so the committed lockfile is never modified.
cp pnpm-workspace.yaml /tmp/ws.bak && cp pnpm-lock.yaml /tmp/lock.bak
sed -i 's|github:jmrossy/jazzicon#|git+https://github.com/jmrossy/jazzicon.git#|' pnpm-workspace.yaml
pnpm install --no-frozen-lockfile
cp /tmp/ws.bak pnpm-workspace.yaml && cp /tmp/lock.bak pnpm-lock.yaml

# §2b — trunk's plugin bundle is a GitHub archive, also unserved. Clone the
# pinned tag over git instead. Sessions then point .trunk/trunk.yaml at it with
# `local:` (an environment-specific edit that must not be committed).
git clone --depth 1 --branch v1.7.3 \
  https://github.com/trunk-io/plugins /opt/trunk-plugins
npx --yes @trunkio/launcher --version   # warm the CLI binary

# Only needed for fork/E2E work.
# curl -L https://foundry.paradigm.xyz | bash && foundryup
```

Baking `trunk` and `/opt/trunk-plugins` into the image would be better than
scripting them, since both of their blockers are structural rather than
transient.

## 6. What is verified working

```bash
pnpm check-types          # 8/8 tasks, ~76s (Next route typegen included)
pnpm test                 # 1182 tests, 0 failures
pnpm quality:budgets:test
pnpm ci:action-pins       # 28 workflow/composite-action files
pnpm dependency:policy:test
pnpm adr:check
pnpm exec turbo run build --filter app.mento.org
```

With §2b and §3 applied, `trunk check` runs the full linter set —
`actionlint`, `yamllint`, `markdownlint`, `checkov`, `prettier`, `eslint` and
the rest. That matters more than it sounds: before it worked, workflow and
Markdown changes could only be validated in CI, because the `pnpm exec
prettier` / `pnpm exec eslint` fallback covers neither. On its first real run
`trunk check` immediately found two `markdownlint/MD040` violations in an
earlier draft of this file that both fallbacks had passed.

Only `.env.example` files are checked in, and the app env schema fails startup
without a real one. `pnpm check-types` supplies its own dummy values, but
`pnpm build` and `pnpm dev` need `apps/<app>/.env.local` to exist. Dummy values
are enough to build (`NEXT_PUBLIC_STORAGE_URL=https://example.com`,
`NEXT_PUBLIC_WALLET_CONNECT_ID=dummy`, `CHAINALYSIS_API_KEY=dummy`, Sentry vars
empty); a real `CHAINALYSIS_API_KEY` is needed only to exercise screening.
