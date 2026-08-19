import { parseAmountWithDefault, type RouteTradingLimit } from "@repo/web3";

interface TradingLimitAmount {
  gt(other: string | number): boolean;
  toFormat(): string;
}

export type SwapTradingLimits = RouteTradingLimit[];

interface CheckTradingLimitViolationParams {
  routeAmounts: string[];
  limits: SwapTradingLimits;
}

function exceedsLimit(amount: TradingLimitAmount, max: string | undefined) {
  return !!max && amount.gt(max);
}

function getTierTimeframe(tier: "L0" | "L1") {
  return tier === "L0" ? "5min" : "1d";
}

function checkRouteLimit(
  routeAmount: string,
  routeLimit: RouteTradingLimit,
): string | null {
  const { L0, L1, LG, direction, tokenSymbol } = routeLimit;
  const amountToCheck = parseAmountWithDefault(routeAmount, 0);
  const maxField = direction === "in" ? "maxIn" : "maxOut";
  let limit = "0";
  let total = "0";
  let timestamp = 0;
  let exceededTier: "L0" | "L1" | "LG" | null = null;

  if (LG && exceedsLimit(amountToCheck, LG[maxField])) {
    limit = LG[maxField];
    timestamp = LG.until;
    exceededTier = "LG";
    total = LG.total;
  } else if (L1 && exceedsLimit(amountToCheck, L1[maxField])) {
    limit = L1[maxField];
    timestamp = L1.until;
    exceededTier = "L1";
    total = L1.total;
  } else if (L0 && exceedsLimit(amountToCheck, L0[maxField])) {
    limit = L0[maxField];
    timestamp = L0.until;
    exceededTier = "L0";
    total = L0.total;
  }

  if (!exceededTier) return null;

  const limitFormatted = parseAmountWithDefault(limit, 0).toFormat();
  const totalFormatted = parseAmountWithDefault(total, 0).toFormat();

  if (direction === "out") {
    if (exceededTier === "LG") {
      return `Cannot buy more than ${limitFormatted} ${tokenSymbol}. This exceeds the global trading limit.`;
    }

    const date = new Date(timestamp * 1000).toLocaleString();
    return `Cannot buy more than ${limitFormatted} ${tokenSymbol} within ${getTierTimeframe(exceededTier)}. The limit will reset to ${totalFormatted} ${tokenSymbol} at ${date}.`;
  }

  if (exceededTier === "LG") {
    return `The ${tokenSymbol} amount exceeds the global trading limit of ${limitFormatted} ${tokenSymbol}.`;
  }

  const date = new Date(timestamp * 1000).toLocaleString();
  return `The ${tokenSymbol} amount exceeds the current trading limit of ${limitFormatted} ${tokenSymbol} within ${getTierTimeframe(exceededTier)}. It will be reset again to ${totalFormatted} ${tokenSymbol} at ${date}.`;
}

export function checkTradingLimitViolation({
  routeAmounts,
  limits,
}: CheckTradingLimitViolationParams): string | null {
  for (const routeLimit of limits) {
    const amountIndex =
      routeLimit.hopIndex + (routeLimit.direction === "out" ? 1 : 0);
    const routeAmount = routeAmounts[amountIndex];
    if (routeAmount == null) continue;

    const violation = checkRouteLimit(routeAmount, routeLimit);
    if (violation) return violation;
  }

  return null;
}
