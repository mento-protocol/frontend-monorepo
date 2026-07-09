# ui.mento.org

Component library showcase for `@repo/ui`, and the host app for Argos visual regression testing (VRT) screenshots.

## Getting Started

First, create a local `.env.local` and fill in the value:

```sh
cp .env.example .env.local
```

`NEXT_PUBLIC_STORAGE_URL` points at the storage bucket used for showcase static assets. CI sets it from the `STORAGE_URL` repository variable; ask a teammate or check the Vercel project env settings for the real value.

Then, run the development server:

```bash
pnpm dev
```

<!-- markdown-link-check-disable -->

Open [http://localhost:3003](http://localhost:3003) with your browser to see the result.

<!-- markdown-link-check-enable -->

## Building

```bash
pnpm build
```

## Visual Regression Testing

```bash
# From the repository root:
pnpm exec turbo run build --filter ui.mento.org...
pnpm --filter ui.mento.org test:visual
```

Diffs are reviewed and baselines are promoted in the Argos dashboard.

## Learn More

To learn more about Next.js, take a look at the [Next.js Documentation](https://nextjs.org/docs).
