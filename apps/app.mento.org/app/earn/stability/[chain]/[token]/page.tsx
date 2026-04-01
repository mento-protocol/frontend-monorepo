import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { EarnView } from "@/components/borrow/earn/earn-view";
import { HiddenTestnetState } from "@/components/shared/hidden-testnet-state";
import { getOpportunityBackLink } from "@/lib/opportunity-navigation";
import {
  DEFAULT_STABILITY_CHAIN_ID,
  getStabilityChainName,
  getStabilityFallbackChainId,
  getStabilityRoute,
  isStabilityChainVisible,
  resolveStabilityChainId,
  resolveStabilityDebtToken,
  readTestnetModeCookie,
  type StabilityChainId,
} from "@/lib/stability-route";

export default async function StabilityPoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ chain: string; token: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const { chain, token } = await params;
  const { source } = await searchParams;
  const sourceValue = Array.isArray(source) ? source[0] : source;
  const backLink = getOpportunityBackLink(sourceValue);
  const routeChainId = resolveStabilityChainId(chain);
  const testnetMode = readTestnetModeCookie((await cookies()).toString());

  if (!routeChainId) {
    return (
      <StabilityPageError
        backHref={backLink.href}
        backLabel={backLink.label}
        title="Unknown network"
        description={`"${chain}" is not a supported network. Try celo.`}
      />
    );
  }

  const debtToken = resolveStabilityDebtToken(token);

  if (!debtToken) {
    return (
      <StabilityPageError
        backHref={backLink.href}
        backLabel={backLink.label}
        title="Unknown stability token"
        description={`"${token}" is not a supported Stability Pool token.`}
      />
    );
  }

  if (!isStabilityChainVisible(routeChainId, testnetMode)) {
    const fallbackChainId =
      getStabilityFallbackChainId(routeChainId) ?? DEFAULT_STABILITY_CHAIN_ID;

    return (
      <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
        <div className="max-w-5xl px-4 pt-6 md:px-0 md:pt-0 w-full">
          <HiddenTestnetState
            title="Testnet hidden"
            description={`${getStabilityChainName(routeChainId) ?? "This testnet"} is available when Testnet Mode is enabled. Enable it from the profile menu, or switch back to mainnet.`}
            fallbackHref={withSource(
              getStabilityRoute(debtToken.symbol, fallbackChainId),
              sourceValue,
            )}
            fallbackLabel={`Open ${getStabilityChainName(fallbackChainId) ?? "mainnet"} Stability Pool`}
            switchChainId={fallbackChainId}
            refreshOnEnable
          />
        </div>
      </div>
    );
  }

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <EarnView
        chainId={routeChainId as StabilityChainId}
        debtToken={debtToken}
      />
    </div>
  );
}

function withSource(path: string, source: string | null | undefined): string {
  if (!source) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}source=${source}`;
}

function StabilityPageError({
  backHref,
  backLabel,
  title,
  description,
}: {
  backHref: "/earn" | "/pools";
  backLabel: "Back to Earn" | "Back to Pools";
  title: string;
  description: string;
}) {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <div className="max-w-5xl px-4 pt-6 md:px-0 md:pt-0 w-full">
        <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
          <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-destructive/50 to-transparent" />
          <div className="mb-7 flex justify-center">
            <div className="h-14 w-14 flex items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <CircleAlert className="h-7 w-7" />
            </div>
          </div>
          <h2 className="mb-2.5 text-xl font-bold tracking-tight">{title}</h2>
          <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
            {description}
          </p>
          <Link
            href={backHref}
            className="gap-1.5 text-sm font-medium inline-flex items-center text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
