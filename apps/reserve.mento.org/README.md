# reserve.mento.org

Reserve dashboard for the Mento Protocol, showing reserve holdings and composition.

## Getting Started

First, create a local `.env.local` and fill in all values:

```sh
cp .env.example .env.local
vim .env.local # or your editor of choice
```

The example file lists the storage URL, analytics API URL, and Sentry DSN/auth token used by this app — find the real values in the Vercel project settings.

Then, run the development server:

```bash
pnpm dev
```

<!-- markdown-link-check-disable -->

Open [http://localhost:3001](http://localhost:3001) with your browser to see the result.

<!-- markdown-link-check-enable -->

## Building

```bash
pnpm build
```

## Learn More

To learn more about Next.js, take a look at the [Next.js Documentation](https://nextjs.org/docs).
