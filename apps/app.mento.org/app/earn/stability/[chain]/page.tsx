import { redirect } from "next/navigation";
import {
  resolveOpportunitySource,
  withOpportunitySource,
} from "@/lib/opportunity-navigation";
import {
  DEFAULT_STABILITY_TOKEN,
  getStabilityRoute,
  resolveStabilityChainId,
  resolveStabilityDebtToken,
} from "@/lib/stability-route";

export default async function StabilityPoolRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ chain: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  const { chain } = await params;
  const { source } = await searchParams;
  const sourceValue = Array.isArray(source) ? source[0] : source;
  const opportunitySource = resolveOpportunitySource(sourceValue);

  const debtToken = resolveStabilityDebtToken(chain);
  if (debtToken) {
    redirect(
      withOpportunitySource(
        getStabilityRoute(debtToken.symbol),
        opportunitySource,
      ),
    );
  }

  const chainId = resolveStabilityChainId(chain);
  if (chainId) {
    redirect(
      withOpportunitySource(
        getStabilityRoute(DEFAULT_STABILITY_TOKEN.symbol, chainId),
        opportunitySource,
      ),
    );
  }

  redirect("/earn");
}
