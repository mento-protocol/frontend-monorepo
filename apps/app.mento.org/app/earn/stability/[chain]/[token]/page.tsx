import Link from "next/link";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { EarnView } from "@/components/borrow/earn/earn-view";
import { getOpportunityBackLink } from "@/lib/opportunity-navigation";
import {
  STABILITY_CHAIN_ID,
  STABILITY_CHAIN_NAME,
  resolveStabilityChainId,
  resolveStabilityDebtToken,
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

  if (routeChainId !== STABILITY_CHAIN_ID) {
    return (
      <StabilityPageError
        backHref={backLink.href}
        backLabel={backLink.label}
        title="Stability Pool unavailable"
        description={`The Stability Pool is currently available on ${STABILITY_CHAIN_NAME} only.`}
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

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <EarnView chainId={STABILITY_CHAIN_ID} debtToken={debtToken} />
    </div>
  );
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
