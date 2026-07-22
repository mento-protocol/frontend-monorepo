import type { ChainId } from "@/config/chains";
import { getMentoSdk, getPublicClient } from "@/features/sdk";
import { toWei } from "@/utils/amount";
import { useDebounce } from "@/utils/debounce";
import { FPMM_ABI } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useChainId } from "wagmi";
import type { PoolDisplay } from "../types";
import { LP_TOTAL_SUPPLY_HOLDER } from "../types";

export type LiquidityQuoteRequest =
  | {
      id: number;
      kind: "manual";
      token: 0 | 1;
      amount: string;
    }
  | {
      id: number;
      kind: "max";
      token: 0 | 1;
      token0Balance: bigint;
      token1Balance: bigint;
    };

export interface LiquidityQuoteResult {
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
  totalSupply: bigint;
  reserve0: bigint;
  reserve1: bigint;
  requestId: number;
  requestKind: LiquidityQuoteRequest["kind"];
  surplus0: bigint;
  surplus1: bigint;
}

interface UseLiquidityQuoteParams {
  pool: PoolDisplay;
  request: LiquidityQuoteRequest | null;
  chainId?: ChainId;
}

export interface BalancedLiquidityAmounts {
  amount0: bigint;
  amount1: bigint;
}

/**
 * Calculates the desired pair in pool contract order. MAX deliberately sends
 * both balances to the Router so its live quote, including integer rounding,
 * chooses the largest feasible pair and the limiting token.
 */
export function getDesiredBalancedLiquidityAmounts(
  request: LiquidityQuoteRequest,
  pool: PoolDisplay,
  reserve0: bigint,
  reserve1: bigint,
): BalancedLiquidityAmounts {
  if (request.kind === "max") {
    return {
      amount0: request.token0Balance,
      amount1: request.token1Balance,
    };
  }

  const driverDecimals =
    request.token === 0 ? pool.token0.decimals : pool.token1.decimals;
  const driverWei = BigInt(toWei(request.amount, driverDecimals).toFixed(0));

  if (request.token === 0) {
    return {
      amount0: driverWei,
      amount1: reserve0 > 0n ? (driverWei * reserve1) / reserve0 : 0n,
    };
  }

  return {
    amount0: reserve1 > 0n ? (driverWei * reserve0) / reserve1 : 0n,
    amount1: driverWei,
  };
}

export function useLiquidityQuote({
  pool,
  request,
  chainId,
}: UseLiquidityQuoteParams) {
  const walletChainId = useChainId() as ChainId;
  const resolvedChainId = chainId ?? walletChainId;

  const manualAmount = request?.kind === "manual" ? request.amount : "";
  const debouncedManualAmount = useDebounce(manualAmount, 350);
  const isManualRequestSettled =
    request?.kind !== "manual" || manualAmount === debouncedManualAmount;
  const isValidRequest =
    request?.kind === "max"
      ? request.token0Balance > 0n && request.token1Balance > 0n
      : request?.kind === "manual"
        ? !!manualAmount && Number(manualAmount) > 0
        : false;

  const query = useQuery<LiquidityQuoteResult | null>({
    queryKey: [
      "liquidity-quote",
      pool.poolAddr,
      resolvedChainId,
      request?.id ?? 0,
      request?.kind ?? "none",
      request?.token ?? 0,
      request?.kind === "manual" ? request.amount : "",
      request?.kind === "max" ? request.token0Balance.toString() : "",
      request?.kind === "max" ? request.token1Balance.toString() : "",
    ],
    queryFn: async () => {
      if (!request || !isValidRequest || !isManualRequestSettled) return null;

      const [sdk, publicClient] = await Promise.all([
        getMentoSdk(resolvedChainId),
        Promise.resolve(getPublicClient(resolvedChainId)),
      ]);

      // PoolService caches details for the SDK lifetime. Read reserves directly
      // at one captured latest block so same-session swaps cannot leave this
      // transaction-critical ratio stale.
      const blockNumber = await publicClient.getBlockNumber();
      const [reserve0, reserve1] = (await publicClient.readContract({
        address: pool.poolAddr as Address,
        abi: FPMM_ABI,
        functionName: "getReserves",
        blockNumber,
      })) as readonly [bigint, bigint, bigint];

      const { amount0, amount1 } = getDesiredBalancedLiquidityAmounts(
        request,
        pool,
        reserve0,
        reserve1,
      );

      // The Router is authoritative: it applies the current reserve ratio and
      // can clip either desired amount. Everything downstream uses its result.
      const [quote, lpBalance] = await Promise.all([
        sdk.liquidity.quoteAddLiquidity(
          pool.poolAddr as Address,
          pool.token0.address as Address,
          amount0,
          pool.token1.address as Address,
          amount1,
        ),
        sdk.liquidity.getLPTokenBalance(pool.poolAddr, LP_TOTAL_SUPPLY_HOLDER),
      ]);

      const token0Balance =
        request.kind === "max" ? request.token0Balance : quote.amountA;
      const token1Balance =
        request.kind === "max" ? request.token1Balance : quote.amountB;

      return {
        amountA: quote.amountA,
        amountB: quote.amountB,
        liquidity: quote.liquidity,
        totalSupply: lpBalance.totalSupply,
        reserve0,
        reserve1,
        requestId: request.id,
        requestKind: request.kind,
        surplus0:
          token0Balance > quote.amountA ? token0Balance - quote.amountA : 0n,
        surplus1:
          token1Balance > quote.amountB ? token1Balance - quote.amountB : 0n,
      };
    },
    enabled: isValidRequest && isManualRequestSettled,
    staleTime: 0,
    gcTime: 30_000,
    refetchOnMount: "always",
  });

  return {
    ...query,
    isDebouncing:
      request?.kind === "manual" && isValidRequest && !isManualRequestSettled,
  };
}
