const CRITICAL_RESOURCE_TYPES = new Set(["document", "script", "stylesheet"]);
const MAXIMUM_URL_INPUT_LENGTH = 2_048;
const INVALID_URL_DISPLAY = "[invalid URL]";

function concise(value) {
  return String(value).replaceAll(/\s+/g, " ").trim().slice(0, 500);
}

export function createRuntimeErrorLedger() {
  return {
    console: [],
    origins: [],
    page: [],
    requests: [],
    responses: [],
    responseDiagnostics: [],
  };
}

export function displayUrl(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAXIMUM_URL_INPUT_LENGTH
  ) {
    return INVALID_URL_DISPLAY;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return INVALID_URL_DISPLAY;
    }
    return url.origin;
  } catch {
    return INVALID_URL_DISPLAY;
  }
}

export function formatConsoleError(message) {
  const location = message.location?.();
  const suffix = location?.url ? ` (${displayUrl(location.url)})` : "";
  return `${concise(message.text())}${suffix}`;
}

export function recordRuntimeResponse(ledger, response) {
  const status = response.status();
  if (status < 400) return;

  const resourceType = response.request().resourceType();
  const detail = `${resourceType} ${displayUrl(response.url())} HTTP ${status}`;
  ledger.responseDiagnostics.push(detail);
  if (CRITICAL_RESOURCE_TYPES.has(resourceType)) ledger.responses.push(detail);
}

export function recordCrossOriginFrame(ledger, frameUrl) {
  ledger.origins.push(displayUrl(frameUrl));
}

export function formatCriticalRequestFailure(request) {
  return `${request.resourceType()} ${displayUrl(request.url())} ${concise(
    request.failure()?.errorText ?? "failed",
  )}`;
}

export function hasAuthoritativeRuntimeErrors(ledger) {
  return [
    ledger.console,
    ledger.origins,
    ledger.page,
    ledger.requests,
    ledger.responses,
  ].some((entries) => entries.length > 0);
}
