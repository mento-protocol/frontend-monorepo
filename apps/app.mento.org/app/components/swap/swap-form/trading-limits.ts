import { parseAmountWithDefault } from "@repo/web3";

interface TradingLimitAmount {
  gt(other: string | number): boolean;
  isZero(): boolean;
  toFormat(): string;
}

interface TradingLimitTier {
  maxIn?: string;
  maxOut?: string;
  total?: string;
  until?: number;
}

export interface SwapTradingLimits {
  L0: TradingLimitTier | null;
  L1: TradingLimitTier | null;
  LG: TradingLimitTier | null;
  tokenToCheck: string | null | undefined;
}

interface CheckTradingLimitViolationParams {
  amountIn: TradingLimitAmount;
  amountOut: TradingLimitAmount;
  limits: SwapTradingLimits;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}

function exceedsLimit(amount: TradingLimitAmount, max: string | undefined) {
  return !!max && !parseAmountWithDefault(max, 0).isZero() && amount.gt(max);
}

function getTierTimeframe(tier: "L0" | "L1") {
  return tier === "L0" ? "5min" : "1d";
}

export function checkTradingLimitViolation({
  amountIn,
  amountOut,
  limits,
  tokenInSymbol,
  tokenOutSymbol,
}: CheckTradingLimitViolationParams): string | null {
  const { L0, L1, LG, tokenToCheck } = limits;

  let amountToCheck: TradingLimitAmount;
  let exceeds = false;
  let limit = "0";
  let total = "0";
  let timestamp = 0;
  let exceededTier: "L0" | "L1" | "LG" | null = null;
  let isImplicitLimit = false;

  if (tokenToCheck === tokenInSymbol) {
    amountToCheck = amountIn;
    if (LG && exceedsLimit(amountToCheck, LG.maxIn)) {
      exceeds = true;
      limit = LG.maxIn ?? "0";
      timestamp = LG.until || 0;
      exceededTier = "LG";
      total = LG.total || "0";
    } else if (L1 && exceedsLimit(amountToCheck, L1.maxIn)) {
      exceeds = true;
      limit = L1.maxIn ?? "0";
      timestamp = L1.until || 0;
      exceededTier = "L1";
      total = L1.total || "0";
    } else if (L0 && exceedsLimit(amountToCheck, L0.maxIn)) {
      exceeds = true;
      limit = L0.maxIn ?? "0";
      timestamp = L0.until || 0;
      exceededTier = "L0";
      total = L0.total || "0";
    }
  } else if (tokenToCheck === tokenOutSymbol) {
    amountToCheck = amountOut;

    if (LG && exceedsLimit(amountToCheck, LG.maxOut)) {
      exceeds = true;
      limit = LG.maxOut ?? "0";
      timestamp = LG.until || 0;
      exceededTier = "LG";
      total = LG.total || "0";
    } else if (L1 && exceedsLimit(amountToCheck, L1.maxOut)) {
      exceeds = true;
      limit = L1.maxOut ?? "0";
      timestamp = L1.until || 0;
      exceededTier = "L1";
      total = L1.total || "0";
    } else if (L0 && exceedsLimit(amountToCheck, L0.maxOut)) {
      exceeds = true;
      limit = L0.maxOut ?? "0";
      timestamp = L0.until || 0;
      exceededTier = "L0";
      total = L0.total || "0";
    }
    isImplicitLimit = true;
  } else {
    return null;
  }

  if (!exceeds || !exceededTier) return null;

  const limitFormatted = parseAmountWithDefault(limit, 0).toFormat();
  const totalFormatted = parseAmountWithDefault(total, 0).toFormat();

  if (isImplicitLimit) {
    if (exceededTier === "LG") {
      return `Cannot buy more than ${limitFormatted} ${tokenToCheck}. This exceeds the global trading limit.`;
    }

    const date = new Date(timestamp * 1000).toLocaleString();
    return `Cannot buy more than ${limitFormatted} ${tokenToCheck} within ${getTierTimeframe(exceededTier)}. The limit will reset to ${totalFormatted} ${tokenToCheck} at ${date}.`;
  }

  if (exceededTier === "LG") {
    return `The ${tokenToCheck} amount exceeds the global trading limit of ${limitFormatted} ${tokenToCheck}.`;
  }

  const date = new Date(timestamp * 1000).toLocaleString();
  return `The ${tokenToCheck} amount exceeds the current trading limit of ${limitFormatted} ${tokenToCheck} within ${getTierTimeframe(exceededTier)}. It will be reset again to ${totalFormatted} ${tokenToCheck} at ${date}.`;
}
