# app.mento.org

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, create a local `.env` and fill in all values:

```sh
cp .env.example .env
vim .env # or your editor of choice
```

Then, run the development server:

```bash
pnpm dev
```

<!-- markdown-link-check-disable -->

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

<!-- markdown-link-check-enable -->

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

Production builds and local development both use Turbopack.

Tailwind CSS is configured through the v4 CSS-first setup. The app imports Tailwind in `app/globals.css`; shared UI source scanning lives in `packages/ui/src/globals.css`.

## Visual Regression Testing

`app.mento.org` has a Playwright + Argos visual suite for disconnected app
shells. Create `apps/app.mento.org/.env` from `.env.example` before running it.
The required visual-run variables are:

- `NEXT_PUBLIC_STORAGE_URL`
- `NEXT_PUBLIC_WALLET_CONNECT_ID`
- `NEXT_PUBLIC_SENTRY_DSN_SWAP`
- `SENTRY_AUTH_TOKEN`

For local screenshot renders, the Sentry DSN and auth token may be empty
strings.

```bash
# From the repository root:
pnpm exec turbo run build --filter app.mento.org
pnpm --filter app.mento.org test:visual
```

Diffs are reviewed and baselines are promoted in the Argos dashboard.

On pull requests, the CI workflow runs this suite only when files that can
affect the app shells change, such as `apps/app.mento.org/**`, `packages/ui/**`,
`packages/web3/**`, root package manager files, `.npmrc`, `turbo.json`,
`scripts/security-headers.mjs`, or `.github/workflows/visual.yml`. On `main`,
that union of visual-impact paths controls whether the workflow starts; every
started run executes both the app and UI suites so its workflow-level success
is valid recovery evidence for the CI failure notifier.

## Connected-Wallet E2E

The same Playwright setup also hosts a functional connected-wallet swap E2E
suite (not VRT) that runs against a seeded local anvil `--celo` fork. From the
repository root, start `pnpm fork:mainnet`, run `pnpm fork:seed`, and build the
app first (`pnpm exec turbo run build --filter app.mento.org` — the suite
starts `next start`). Then run `pnpm --filter app.mento.org test:connected`.
See [#445](https://github.com/mento-protocol/frontend-monorepo/issues/445) for
the full runbook.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
