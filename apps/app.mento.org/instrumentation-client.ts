// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { env } from "@/env.mjs";
import { redactWalletData } from "@/lib/sentry-redaction";
import {
  createDedupedSentryEventFilter,
  filterNoisySentryEvents,
  sentryDenyUrls,
  sentryIgnoreErrors,
} from "@repo/web3/sentry-filter";

const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development";

const filterEvent =
  vercelEnv === "preview"
    ? createDedupedSentryEventFilter()
    : filterNoisySentryEvents;

// Kept events have wallet addresses, calldata and transaction hashes redacted
// from their exception values, message, extra, request URL and breadcrumbs.
const beforeSend: typeof filterEvent = (event, hint) => {
  const keptEvent = filterEvent(event, hint);
  return keptEvent ? redactWalletData(keptEvent) : null;
};

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN_SWAP,

  // Disable Sentry in development to avoid localhost errors
  enabled: process.env.NODE_ENV === "production",

  environment: vercelEnv,

  // Add optional integrations for additional features
  integrations: [
    Sentry.zodErrorsIntegration(),
    // Defaults mask all text and inputs and block media in replays.
    // Recorded console and network events have wallet data redacted.
    Sentry.replayIntegration({
      beforeAddRecordingEvent: (event) => redactWalletData(event),
    }),
  ],

  // Do not attach request headers or user IP addresses to events, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,

  ignoreErrors: sentryIgnoreErrors,
  denyUrls: sentryDenyUrls,
  beforeSend,
  beforeBreadcrumb: (breadcrumb) => redactWalletData(breadcrumb),

  tracesSampleRate: vercelEnv === "production" ? 0.1 : 0,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 1%.
  // Because we only get 500 replay sessions per month, we want to reserve most of our replays for errors.
  replaysSessionSampleRate: 0.01,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
