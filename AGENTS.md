# Mento Frontend Monorepo Instructions

Read `CLAUDE.md` for repo-local frontend conventions and commands.

For any protocol-level question that crosses beyond this frontend repo, first
read the private `mento-master-context` router when the checkout is available:

```text
../mento-master-context/.agents/mento-context/README.md
```

This applies before broad repo searches or drafting copy about contracts,
deployments, addresses, ABIs, live on-chain state, stable supply, reserve data,
monitoring/data semantics, docs, the whitepaper, business model, or legal/risk
framing. Load only the relevant master-context card(s), then return to this repo
for frontend implementation details. It is a router, not live truth; verify
current values through the source-specific repo, API, RPC, or frontend path it
points to. When answering, mention which master-context card you used or state
that the checkout was unavailable.
