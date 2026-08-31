import {
  ROUTER_ABI,
  type PreparedZapIn,
  type ZapInDetails,
  type ZapInTransaction,
} from "@mento-protocol/mento-sdk";
import { encodeFunctionData, type Address } from "viem";

const ZAP_IN_SPLIT_BPS_DENOMINATOR = 10_000;

export type ZapInSelectedToken = "token0" | "token1";

export interface ZapInSplitProjection {
  splitBps: number;
  sdkSplitRatio: number;
  amountInA: bigint;
  amountInB: bigint;
  swapAmount: bigint;
  retainedAmount: bigint;
  amountOut: bigint;
  postSwapReserve0: bigint;
  postSwapReserve1: bigint;
  depositedAmount0: bigint;
  depositedAmount1: bigint;
  selectedTokenRefund: bigint;
  generatedTokenRefund: bigint;
}

interface ZapInPoolState {
  amountIn: bigint;
  selectedToken: ZapInSelectedToken;
  reserve0: bigint;
  reserve1: bigint;
  /**
   * True when the swap route is the target pool itself. A route which does not
   * touch the target pool leaves its reserves unchanged.
   */
  swapMovesTargetReserves: boolean;
  /** The target FPMM protocol fee in basis points. */
  protocolFeeBps: number;
}

export interface ProjectZapInSplitInput extends ZapInPoolState {
  splitBps: number;
  amountOut: bigint;
}

export interface FindBindingZapInSplitInput extends ZapInPoolState {
  /**
   * Returns the expected counter-token output for a candidate swap amount.
   * The caller can derive this synchronous quote from one live FPMM probe.
   */
  getAmountOut: (swapAmount: bigint) => bigint;
}

export interface BindingZapInPlan {
  projection: ZapInSplitProjection;
  selectedToken: ZapInSelectedToken;
  swapMovesTargetReserves: boolean;
  tokenA: string;
  tokenB: string;
  targetFactory: string;
  swapFactory: string;
}

function validateBasisPoints(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer between 0 and 10000`);
  }
}

function assertPositive(value: bigint, label: string): void {
  if (value <= 0n) throw new Error(`${label} must be greater than zero`);
}

/**
 * Converts integer basis points to a number that survives the SDK's
 * `Math.floor(splitRatio * 10000)` conversion.
 *
 * A direct `splitBps / 10000` conversion is unsafe for some values because
 * binary floating-point rounding can move the result below the intended
 * integer. An interior half-basis-point value always floors to the requested
 * integer.
 */
export function toSdkZapInSplitRatio(splitBps: number): number {
  validateBasisPoints(splitBps, "splitBps");

  if (splitBps === 10_000) return 1;

  const ratio = (splitBps + 0.5) / ZAP_IN_SPLIT_BPS_DENOMINATOR;
  if (Math.floor(ratio * ZAP_IN_SPLIT_BPS_DENOMINATOR) !== splitBps) {
    throw new Error("Unable to represent the zap-in split for the SDK");
  }
  return ratio;
}

export function toZapInProtocolFeeBps(protocolFee: bigint): number {
  if (protocolFee < 0n || protocolFee > 10_000n) {
    throw new Error("protocolFee must be between 0 and 10000 basis points");
  }
  return Number(protocolFee);
}

export function splitZapInAmount(
  amountIn: bigint,
  splitBps: number,
): { amountInA: bigint; amountInB: bigint } {
  assertPositive(amountIn, "amountIn");
  validateBasisPoints(splitBps, "splitBps");

  const amountInA =
    (amountIn * BigInt(splitBps)) / BigInt(ZAP_IN_SPLIT_BPS_DENOMINATOR);
  return { amountInA, amountInB: amountIn - amountInA };
}

export function quoteZapInDeposit(
  amount0Desired: bigint,
  amount1Desired: bigint,
  reserve0: bigint,
  reserve1: bigint,
): { amount0: bigint; amount1: bigint } {
  assertPositive(amount0Desired, "amount0Desired");
  assertPositive(amount1Desired, "amount1Desired");
  assertPositive(reserve0, "reserve0");
  assertPositive(reserve1, "reserve1");

  const amount1Optimal = (amount0Desired * reserve1) / reserve0;
  if (amount1Optimal <= amount1Desired) {
    return { amount0: amount0Desired, amount1: amount1Optimal };
  }

  return {
    amount0: (amount1Desired * reserve0) / reserve1,
    amount1: amount1Desired,
  };
}

/**
 * Mirrors the target FPMM reserve change and Router liquidity quote for one
 * candidate split. `splitBps` always describes the amount routed to token0.
 */
export function projectZapInSplit({
  amountIn,
  selectedToken,
  reserve0,
  reserve1,
  swapMovesTargetReserves,
  protocolFeeBps,
  splitBps,
  amountOut,
}: ProjectZapInSplitInput): ZapInSplitProjection {
  assertPositive(reserve0, "reserve0");
  assertPositive(reserve1, "reserve1");
  assertPositive(amountOut, "amountOut");
  validateBasisPoints(protocolFeeBps, "protocolFeeBps");

  if (splitBps <= 0 || splitBps >= ZAP_IN_SPLIT_BPS_DENOMINATOR) {
    throw new Error("splitBps must leave a non-zero amount for both zap legs");
  }

  const { amountInA, amountInB } = splitZapInAmount(amountIn, splitBps);
  const retainedAmount = selectedToken === "token0" ? amountInA : amountInB;
  const swapAmount = selectedToken === "token0" ? amountInB : amountInA;
  assertPositive(retainedAmount, "retainedAmount");
  assertPositive(swapAmount, "swapAmount");

  let postSwapReserve0 = reserve0;
  let postSwapReserve1 = reserve1;

  if (swapMovesTargetReserves) {
    const protocolFee =
      (swapAmount * BigInt(protocolFeeBps)) /
      BigInt(ZAP_IN_SPLIT_BPS_DENOMINATOR);
    const netSwapInput = swapAmount - protocolFee;

    if (selectedToken === "token0") {
      if (amountOut >= reserve1) {
        throw new Error("Swap output must stay below the token1 reserve");
      }
      postSwapReserve0 += netSwapInput;
      postSwapReserve1 -= amountOut;
    } else {
      if (amountOut >= reserve0) {
        throw new Error("Swap output must stay below the token0 reserve");
      }
      postSwapReserve0 -= amountOut;
      postSwapReserve1 += netSwapInput;
    }
  }

  const desiredAmount0 =
    selectedToken === "token0" ? retainedAmount : amountOut;
  const desiredAmount1 =
    selectedToken === "token1" ? retainedAmount : amountOut;
  const deposited = quoteZapInDeposit(
    desiredAmount0,
    desiredAmount1,
    postSwapReserve0,
    postSwapReserve1,
  );

  const selectedTokenRefund =
    selectedToken === "token0"
      ? retainedAmount - deposited.amount0
      : retainedAmount - deposited.amount1;
  const generatedTokenRefund =
    selectedToken === "token0"
      ? amountOut - deposited.amount1
      : amountOut - deposited.amount0;

  return {
    splitBps,
    sdkSplitRatio: toSdkZapInSplitRatio(splitBps),
    amountInA,
    amountInB,
    swapAmount,
    retainedAmount,
    amountOut,
    postSwapReserve0,
    postSwapReserve1,
    depositedAmount0: deposited.amount0,
    depositedAmount1: deposited.amount1,
    selectedTokenRefund,
    generatedTokenRefund,
  };
}

/**
 * Selects the closest one-basis-point split on the more-swap side of the
 * balance point. This makes the selected input token the binding deposit side.
 */
export function findBindingZapInSplit(
  input: FindBindingZapInSplitInput,
): ZapInSplitProjection {
  const start = input.selectedToken === "token0" ? 9_999 : 1;
  const end = input.selectedToken === "token0" ? 0 : 10_000;
  const step = input.selectedToken === "token0" ? -1 : 1;

  for (let splitBps = start; splitBps !== end; splitBps += step) {
    const { amountInA, amountInB } = splitZapInAmount(input.amountIn, splitBps);
    const swapAmount = input.selectedToken === "token0" ? amountInB : amountInA;
    const retainedAmount =
      input.selectedToken === "token0" ? amountInA : amountInB;
    if (swapAmount === 0n || retainedAmount === 0n) continue;

    const amountOut = input.getAmountOut(swapAmount);
    if (amountOut <= 0n) continue;

    let projection: ZapInSplitProjection;
    try {
      projection = projectZapInSplit({ ...input, splitBps, amountOut });
    } catch {
      continue;
    }

    if (projection.selectedTokenRefund === 0n) return projection;
  }

  throw new Error("No selected-token-binding zap-in split is available");
}

function isSameAddress(first: string, second: string): boolean {
  return first.toLowerCase() === second.toLowerCase();
}

function getZapInRouteShape(details: ZapInDetails): {
  selectedToken: ZapInSelectedToken;
  swapMovesTargetReserves: boolean;
  swapAmount: bigint;
  swapFactory: string;
} {
  if (details.amountInA + details.amountInB !== details.amountIn) {
    throw new Error("Zap-in split amounts do not sum to the input amount");
  }

  const { tokenA, tokenB, factory } = details.zapParams;
  const selectedIsTokenA = isSameAddress(details.tokenIn, tokenA);
  const selectedIsTokenB = isSameAddress(details.tokenIn, tokenB);
  if (selectedIsTokenA === selectedIsTokenB) {
    throw new Error("The zap input must match exactly one pool token");
  }

  const selectedRoutes = selectedIsTokenA ? details.routesA : details.routesB;
  const swapRoutes = selectedIsTokenA ? details.routesB : details.routesA;
  const counterToken = selectedIsTokenA ? tokenB : tokenA;
  if (selectedRoutes.length !== 0) {
    throw new Error("The selected-token zap leg must not contain a swap route");
  }
  if (swapRoutes.length !== 1) {
    throw new Error("The counter-token zap leg must use one swap route");
  }

  const swapRoute = swapRoutes[0];
  if (!swapRoute) {
    throw new Error("The counter-token zap leg must use one swap route");
  }
  if (
    !isSameAddress(swapRoute.from, details.tokenIn) ||
    !isSameAddress(swapRoute.to, counterToken)
  ) {
    throw new Error("The counter-token zap route does not match the pool pair");
  }
  if (!isSameAddress(swapRoute.factory, factory)) {
    throw new Error("The counter-token zap route must use the target pool");
  }

  return {
    selectedToken: selectedIsTokenA ? "token0" : "token1",
    swapMovesTargetReserves: true,
    swapAmount: selectedIsTokenA ? details.amountInB : details.amountInA,
    swapFactory: swapRoute.factory,
  };
}

/**
 * Calculates the nearest basis-point split which makes the selected input the
 * binding liquidity side. The probe must use zero slippage so its swap output
 * is a conservative linear quote for other split amounts.
 */
export function deriveBindingZapInPlan({
  prepared,
  reserve0,
  reserve1,
  protocolFeeBps,
}: {
  prepared: PreparedZapIn;
  reserve0: bigint;
  reserve1: bigint;
  protocolFeeBps: number;
}): BindingZapInPlan {
  const route = getZapInRouteShape(prepared.details);
  const probeAmountOut =
    route.selectedToken === "token0"
      ? prepared.quote.amountOutFromB
      : prepared.quote.amountOutFromA;
  assertPositive(route.swapAmount, "probeSwapAmount");
  assertPositive(probeAmountOut, "probeAmountOut");

  const projection = findBindingZapInSplit({
    amountIn: prepared.details.amountIn,
    selectedToken: route.selectedToken,
    reserve0,
    reserve1,
    swapMovesTargetReserves: route.swapMovesTargetReserves,
    protocolFeeBps,
    getAmountOut: (swapAmount) =>
      (swapAmount * probeAmountOut) / route.swapAmount,
  });

  return {
    projection,
    selectedToken: route.selectedToken,
    swapMovesTargetReserves: route.swapMovesTargetReserves,
    tokenA: prepared.details.zapParams.tokenA,
    tokenB: prepared.details.zapParams.tokenB,
    targetFactory: prepared.details.zapParams.factory,
    swapFactory: route.swapFactory,
  };
}

/** Verifies that the final SDK build kept the exact calculated split and route. */
export function assertBindingZapInPlan(
  details: ZapInDetails,
  plan: BindingZapInPlan,
): void {
  const route = getZapInRouteShape(details);
  if (
    details.amountInA !== plan.projection.amountInA ||
    details.amountInB !== plan.projection.amountInB
  ) {
    throw new Error("The final zap-in build changed the calculated split");
  }
  if (
    route.selectedToken !== plan.selectedToken ||
    route.swapMovesTargetReserves !== plan.swapMovesTargetReserves ||
    !isSameAddress(route.swapFactory, plan.swapFactory) ||
    !isSameAddress(details.zapParams.tokenA, plan.tokenA) ||
    !isSameAddress(details.zapParams.tokenB, plan.tokenB) ||
    !isSameAddress(details.zapParams.factory, plan.targetFactory)
  ) {
    throw new Error("The final zap-in build changed the calculated route");
  }
}

/**
 * Makes a successful zap spend the full selected input token. State drift can
 * then make the transaction revert, but it cannot make it succeed with a
 * refund of the retained selected-token leg.
 */
export function bindSelectedTokenMinimum(
  transaction: ZapInTransaction,
  recipient: Address,
): ZapInTransaction {
  const { zapIn } = transaction;
  if (zapIn.amountInA + zapIn.amountInB !== zapIn.amountIn) {
    throw new Error("Zap-in split amounts do not sum to the input amount");
  }

  const selectedIsTokenA = isSameAddress(zapIn.tokenIn, zapIn.zapParams.tokenA);
  const selectedIsTokenB = isSameAddress(zapIn.tokenIn, zapIn.zapParams.tokenB);
  if (selectedIsTokenA === selectedIsTokenB) {
    throw new Error("The zap input must match exactly one pool token");
  }
  if (selectedIsTokenA && zapIn.routesA.length !== 0) {
    throw new Error("The selected tokenA leg must not contain a swap route");
  }
  if (selectedIsTokenB && zapIn.routesB.length !== 0) {
    throw new Error("The selected tokenB leg must not contain a swap route");
  }

  const zapParams = {
    ...zapIn.zapParams,
    amountAMin: selectedIsTokenA ? zapIn.amountInA : zapIn.zapParams.amountAMin,
    amountBMin: selectedIsTokenB ? zapIn.amountInB : zapIn.zapParams.amountBMin,
  };
  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "zapIn",
    args: [
      zapIn.tokenIn as Address,
      zapIn.amountInA,
      zapIn.amountInB,
      {
        tokenA: zapParams.tokenA as Address,
        tokenB: zapParams.tokenB as Address,
        factory: zapParams.factory as Address,
        amountOutMinA: zapParams.amountOutMinA,
        amountOutMinB: zapParams.amountOutMinB,
        amountAMin: zapParams.amountAMin,
        amountBMin: zapParams.amountBMin,
      },
      zapIn.routesA,
      zapIn.routesB,
      recipient,
    ],
  });

  return {
    ...transaction,
    zapIn: {
      ...zapIn,
      params: { ...zapIn.params, data },
      zapParams,
    },
  };
}
