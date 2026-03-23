export type OpportunitySource = "earn" | "pools";

export function resolveOpportunitySource(
  source: string | null | undefined,
): OpportunitySource {
  return source === "earn" ? "earn" : "pools";
}

export function getOpportunityBackLink(source: string | null | undefined): {
  href: "/earn" | "/pools";
  label: "Back to Earn" | "Back to Pools";
} {
  const resolvedSource = resolveOpportunitySource(source);

  return resolvedSource === "earn"
    ? { href: "/earn", label: "Back to Earn" }
    : { href: "/pools", label: "Back to Pools" };
}

export function withOpportunitySource(
  path: string,
  source: OpportunitySource,
): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}source=${source}`;
}
