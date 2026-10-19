"use client";

import * as Sentry from "@sentry/nextjs";
import { setErrorReporter } from "@repo/web3";
import { useEffect } from "react";

/**
 * Registers Sentry as the reporter for handled errors raised inside
 * `@repo/web3` (transaction flows, swap and approve sends).
 *
 * Usage: Call this hook once at the root of your app (e.g., in providers.tsx)
 */
export function useSentryErrorReporter() {
  useEffect(() => {
    setErrorReporter((error, context) => {
      Sentry.captureException(error, { extra: context });
    });
    return () => setErrorReporter(null);
  }, []);
}
