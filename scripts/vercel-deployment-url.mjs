const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function canonicalizeHostname(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Alias hostname is required");
  }
  const hasScheme = value.includes("://");
  let hostname;
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("Alias URL contains forbidden components");
    }
    hostname = url.hostname;
  } catch {
    throw new Error("Alias hostname is malformed");
  }
  hostname = hostname.toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new Error("Alias hostname is malformed");
  }
  return hostname;
}

export function canonicalizeDeploymentUrl(value) {
  const hostname = canonicalizeHostname(value);
  if (!hostname.endsWith(".vercel.app")) {
    throw new Error("Deployment URL must use an immutable vercel.app host");
  }
  return `https://${hostname}`;
}
