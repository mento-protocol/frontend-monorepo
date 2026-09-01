const GOVERNANCE_PRODUCTION_ORIGIN = "https://governance.mento.org";
const GOVERNANCE_LOCAL_ORIGIN = "http://localhost:3002";
const MENTO_VERCEL_SUFFIX = "-mentolabs.vercel.app";

interface GraphRequestOriginOptions {
  vercelEnvironment?: string;
  vercelUrl?: string;
}

function getMentoVercelOrigin(vercelUrl: string | undefined): string {
  if (!vercelUrl) {
    throw new Error("VERCEL_URL is required for preview Graph requests");
  }

  const url = new URL(
    vercelUrl.includes("://") ? vercelUrl : `https://${vercelUrl}`,
  );
  const prefix = url.hostname.slice(0, -MENTO_VERCEL_SUFFIX.length);

  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(MENTO_VERCEL_SUFFIX) ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(prefix) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("VERCEL_URL is outside the Mento Vercel team domain");
  }

  return url.origin;
}

export function getGraphRequestOrigin({
  vercelEnvironment = process.env.NEXT_PUBLIC_VERCEL_ENV,
  // Declared in the Governance turbo.json as a runtime-only pass-through value.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  vercelUrl = process.env.VERCEL_URL,
}: GraphRequestOriginOptions = {}): string {
  if (vercelEnvironment === "production") {
    return GOVERNANCE_PRODUCTION_ORIGIN;
  }

  if (vercelEnvironment === "preview") {
    return getMentoVercelOrigin(vercelUrl);
  }

  return GOVERNANCE_LOCAL_ORIGIN;
}
