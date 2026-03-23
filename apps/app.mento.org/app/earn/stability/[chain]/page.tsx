import { redirect } from "next/navigation";
import {
  DEFAULT_STABILITY_TOKEN,
  getStabilityRoute,
  resolveStabilityChainId,
  resolveStabilityDebtToken,
} from "@/lib/stability-route";

export default async function StabilityPoolRedirectPage({
  params,
}: {
  params: Promise<{ chain: string }>;
}) {
  const { chain } = await params;

  const debtToken = resolveStabilityDebtToken(chain);
  if (debtToken) {
    redirect(getStabilityRoute(debtToken.symbol));
  }

  const chainId = resolveStabilityChainId(chain);
  if (chainId) {
    redirect(getStabilityRoute(DEFAULT_STABILITY_TOKEN.symbol));
  }

  redirect("/earn");
}
