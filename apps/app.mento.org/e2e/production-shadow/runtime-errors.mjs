const CRITICAL_RESOURCE_TYPES = new Set(["document", "script", "stylesheet"]);

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

export function formatConsoleError(message) {
  const location = message.location?.();
  const suffix = location?.url ? ` (${concise(location.url)})` : "";
  return `${concise(message.text())}${suffix}`;
}

export function recordRuntimeResponse(ledger, response) {
  const status = response.status();
  if (status < 400) return;

  const resourceType = response.request().resourceType();
  const detail = `${resourceType} ${concise(response.url())} HTTP ${status}`;
  ledger.responseDiagnostics.push(detail);
  if (CRITICAL_RESOURCE_TYPES.has(resourceType)) ledger.responses.push(detail);
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
