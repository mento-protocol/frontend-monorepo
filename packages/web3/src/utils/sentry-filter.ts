import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const ALWAYS_IGNORE_ERROR_PATTERNS = [
  /Origin not allowed/i,
  /has not been authorized yet/i,
  /Cannot set property ethereum of #<Window> which has only a getter/i,
  /'set' on proxy: trap returned falsish for property 'tronlinkParams'/i,
  /WebSocket connection failed for host: wss:\/\/relay\.walletconnect\.org/i,
] as const;

const CHUNK_LOAD_ERROR_PATTERNS = [
  /Failed to load chunk/i,
  /Loading chunk [\w./?-]+ failed/i,
  /ChunkLoadError/i,
] as const;

const SHARED_ENVIRONMENT_ERROR_PATTERNS = [
  /Cannot read properties of null \(reading 'removeChild'\)/i,
  /Maximum call stack size exceeded/i,
  /Object captured as promise rejection with keys:/i,
] as const;

const EXTENSION_URL_PATTERNS = [
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-web-extension:\/\//i,
  /^webkit-masked-url:\/\//i,
  /^extension:\/\//i,
] as const;

const FIRST_PARTY_FRAME_PATTERNS = [
  /\/_next\//i,
  /app\.mento\.org/i,
  /governance\.mento\.org/i,
  /reserve\.mento\.org/i,
  /localhost:\d+/i,
] as const;

const MERKL_PROXY_ERROR_PATTERNS = [
  /fetch failed/i,
  /failed to pipe response/i,
] as const;

export const sentryIgnoreErrors = [...ALWAYS_IGNORE_ERROR_PATTERNS];
export const sentryDenyUrls = [...EXTENSION_URL_PATTERNS];

function getEventMessage(event: ErrorEvent, hint?: EventHint): string {
  const exception = event.exception?.values?.[0];

  if (typeof event.message === "string" && event.message.length > 0) {
    return event.message;
  }

  if (typeof exception?.value === "string" && exception.value.length > 0) {
    return exception.value;
  }

  if (typeof hint?.originalException === "string") {
    return hint.originalException;
  }

  if (hint?.originalException instanceof Error) {
    return hint.originalException.message;
  }

  return "";
}

function getFrameFilenames(event: ErrorEvent): string[] {
  return (event.exception?.values ?? [])
    .flatMap((value) => value.stacktrace?.frames ?? [])
    .map((frame) => frame.filename)
    .filter((filename): filename is string => Boolean(filename));
}

function hasFirstPartyFrames(event: ErrorEvent): boolean {
  return getFrameFilenames(event).some((filename) =>
    FIRST_PARTY_FRAME_PATTERNS.some((pattern) => pattern.test(filename)),
  );
}

function hasExtensionFrames(event: ErrorEvent): boolean {
  return getFrameFilenames(event).some((filename) =>
    EXTENSION_URL_PATTERNS.some((pattern) => pattern.test(filename)),
  );
}

function eventTargetsRoute(event: ErrorEvent, route: string): boolean {
  const requestUrl = event.request?.url ?? "";
  const transaction = event.transaction ?? "";

  return requestUrl.includes(route) || transaction.includes(route);
}

export function filterNoisySentryEvents(
  event: ErrorEvent,
  hint?: EventHint,
): ErrorEvent | null {
  const message = getEventMessage(event, hint);

  if (ALWAYS_IGNORE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return null;
  }

  if (
    CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message)) &&
    hasExtensionFrames(event)
  ) {
    return null;
  }

  if (
    eventTargetsRoute(event, "/api/merkl/opportunities") &&
    MERKL_PROXY_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return null;
  }

  if (
    SHARED_ENVIRONMENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    if (hasExtensionFrames(event) || !hasFirstPartyFrames(event)) {
      return null;
    }
  }

  return event;
}
