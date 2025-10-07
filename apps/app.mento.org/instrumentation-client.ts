// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { env } from "@/env.mjs";

Sentry.init({
  dsn: env.NEXT_PUBLIC_SENTRY_DSN_SWAP,

  // Disable Sentry in development to avoid localhost errors
  enabled: process.env.NODE_ENV === "production",

  // Add optional integrations for additional features
  integrations: [
    Sentry.zodErrorsIntegration(),
    Sentry.replayIntegration({
      // There is no sensitive data on this site, all data is public on-chain so this shouldn't be a privacy concern
      maskAllText: false,
      maskAllInputs: false,
      blockAllMedia: false,
    }),
  ],

  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 0.1,

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
