import process from "node:process";

const VERCEL_LIVE_ORIGIN = "https://vercel.live";

const vercelPreviewCspExtensions = {
  "script-src": {
    additionalSources: [VERCEL_LIVE_ORIGIN],
    fallbackSources: ["'self'", VERCEL_LIVE_ORIGIN],
  },
  "connect-src": {
    additionalSources: [VERCEL_LIVE_ORIGIN],
    fallbackSources: ["'self'", VERCEL_LIVE_ORIGIN],
  },
  "frame-src": {
    additionalSources: [VERCEL_LIVE_ORIGIN],
    fallbackSources: ["'self'", VERCEL_LIVE_ORIGIN],
  },
};

/**
 * Shared HTTP security headers for all four Next.js apps.
 *
 * Single source of truth wired into each app's `next.config.ts` `headers()`.
 * Kept at the repo root (not in @repo/web3) because it must import cleanly from
 * a Node config context on a clean checkout — before any package `dist/` is
 * built — and ui.mento.org does not depend on @repo/web3 at all.
 *
 * Registered in `turbo.json` `globalDependencies` so edits invalidate every
 * cached app build.
 *
 * Two layers ship together:
 *   1. Enforced anti-framing + hardening headers (frame-ancestors 'none',
 *      X-Frame-Options DENY, nosniff, referrer-policy, permissions-policy).
 *   2. The full per-app CSP in REPORT-ONLY mode, so we can gather telemetry
 *      before a later enforcement flip. `frame-ancestors` is intentionally NOT
 *      in the report-only policy — the CSP spec ignores it in monitoring mode;
 *      it only works in the enforced `Content-Security-Policy` header below.
 */

/**
 * @param {{ reportOnlyCsp?: string }} [options]
 * @returns {{ key: string, value: string }[]}
 */
export function buildSecurityHeaders({ reportOnlyCsp } = {}) {
  const resolvedReportOnlyCsp = allowVercelLiveInPreview(reportOnlyCsp);
  const headers = [
    { key: "X-Frame-Options", value: "DENY" },
    // Enforced now — keep this to exactly `frame-ancestors 'none'`. Pasting the
    // full policy here would enforce it immediately and break wallet flows.
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];

  if (resolvedReportOnlyCsp) {
    headers.push({
      key: "Content-Security-Policy-Report-Only",
      value: resolvedReportOnlyCsp,
    });
  }

  return headers;
}

/**
 * Vercel injects the preview feedback widget from https://vercel.live on preview
 * deployments. Keep production CSP telemetry stricter while avoiding noisy
 * report-only violations during PR review.
 *
 * @param {string | undefined} reportOnlyCsp
 * @returns {string | undefined}
 */
function allowVercelLiveInPreview(reportOnlyCsp) {
  if (!reportOnlyCsp || process.env.VERCEL_ENV !== "preview") {
    return reportOnlyCsp;
  }

  return appendCspSources(reportOnlyCsp, vercelPreviewCspExtensions);
}

/**
 * @param {string} csp
 * @param {Record<string, { additionalSources: string[], fallbackSources: string[] }>} extensions
 * @returns {string}
 */
function appendCspSources(csp, extensions) {
  const seenDirectiveNames = new Set();
  const directives = csp
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => {
      const [name, ...sources] = directive.split(/\s+/);
      const extension = extensions[name];

      if (!extension) {
        return directive;
      }

      seenDirectiveNames.add(name);
      const existingSources = new Set(sources);
      const missingSources = extension.additionalSources.filter(
        (source) => !existingSources.has(source),
      );

      return [name, ...sources, ...missingSources].join(" ");
    });

  for (const [name, extension] of Object.entries(extensions)) {
    if (!seenDirectiveNames.has(name)) {
      directives.push([name, ...extension.fallbackSources].join(" "));
    }
  }

  return directives.join("; ");
}

/**
 * Derive Sentry's CSP report endpoint from a DSN.
 *
 * DSN shape:   https://<key>@<ingestHost>/<projectId>
 * Report URI:  https://<ingestHost>/api/<projectId>/security/?sentry_key=<key>
 *
 * The ingest host varies (o<org>.ingest.sentry.io vs o<org>.ingest.us.sentry.io),
 * so parse with `new URL()` rather than pattern-matching a fixed shape.
 *
 * @param {string | undefined} dsn
 * @returns {string} the report URI, or "" if the DSN is missing/unparseable
 */
export function sentryCspReportUri(dsn) {
  if (!dsn) return "";
  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!key || !projectId) return "";
    return `https://${url.host}/api/${projectId}/security/?sentry_key=${key}`;
  } catch {
    return "";
  }
}

/**
 * Extract the origin (scheme://host[:port]) from a URL string, or "" if it does
 * not parse. Used to turn env-configured API endpoints into `connect-src`
 * entries without hardcoding a snapshot of their current values.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
export function originOf(value) {
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}
