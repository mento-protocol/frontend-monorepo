import { isUserRejectionForTelemetry } from "./is-user-rejection";

export type ErrorReporter = (
  error: unknown,
  context?: Record<string, unknown>,
) => void;

let currentReporter: ErrorReporter | null = null;

/**
 * Registers the function that forwards handled errors to monitoring.
 * The app registers a Sentry-backed reporter; pass `null` to clear it.
 */
export function setErrorReporter(reporter: ErrorReporter | null): void {
  currentReporter = reporter;
}

/**
 * Reports a handled error to the registered reporter. It is a no-op when no
 * reporter is registered or when the user rejected the wallet request, and it
 * never throws, so telemetry cannot break a transaction flow.
 */
export function reportError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!currentReporter) return;
  try {
    if (isUserRejectionForTelemetry(error)) return;
    currentReporter(error, context);
  } catch {
    // Telemetry must never break the calling flow.
  }
}
