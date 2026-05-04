// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { env } from "@/env.mjs";
import {
  createDedupedSentryEventFilter,
  filterNoisySentryEvents,
  sentryDenyUrls,
  sentryIgnoreErrors,
} from "@repo/web3/sentry-filter";

const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development";

const beforeSend =
  vercelEnv === "preview"
    ? createDedupedSentryEventFilter()
    : filterNoisySentryEvents;

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN_RESERVE,

  // Disable Sentry in development to avoid localhost errors
  enabled: process.env.NODE_ENV === "production",

  environment: vercelEnv,

  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  ignoreErrors: sentryIgnoreErrors,
  denyUrls: sentryDenyUrls,
  beforeSend,

  tracesSampleRate: vercelEnv === "production" ? 0.1 : 0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
