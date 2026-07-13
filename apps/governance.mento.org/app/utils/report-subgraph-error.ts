import * as Sentry from "@sentry/nextjs";

const REPORT_DEDUPE_MS = 5 * 60 * 1000;
const lastReportedAtByKey = new Map<string, number>();

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error("Unknown governance subgraph error");
}

export function reportSubgraphError(error: unknown, queryName: string): void {
  const normalizedError = normalizeError(error);
  const reportKey = [
    queryName,
    normalizedError.name,
    normalizedError.message,
  ].join(":");
  const now = Date.now();
  const lastReportedAt = lastReportedAtByKey.get(reportKey) ?? 0;

  if (now - lastReportedAt < REPORT_DEDUPE_MS) {
    return;
  }

  lastReportedAtByKey.set(reportKey, now);

  Sentry.captureException(normalizedError, {
    tags: {
      context: "governance-subgraph",
      queryName,
    },
  });
}
