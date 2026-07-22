import type { ChainId } from "@/config/chains";
import { getMentoSdk } from "@/features/sdk";
import { logger } from "@/utils/logger";
import { toast } from "@mento-protocol/ui";
import {
  FPMM_ABI,
  ROUTER_ABI,
  type ZapInTransaction,
} from "@mento-protocol/mento-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { useChainId, usePublicClient, useSendTransaction } from "wagmi";
import { showLiquiditySuccessToast } from "../liquidity-toast";
import type { PoolDisplay, SlippageOption } from "../types";
import { getTransactionErrorMessage } from "../types";

const FPMM_FACTORY_POOL_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB) view returns (address)",
]);

type ZapRoute = ZapInTransaction["zapIn"]["routesA"];

export interface ZapInBuildAttempt {
  build: ZapInTransaction | null;
  error: string | null;
}

function getZapInBuildError(message: string): string | null {
  if (/no viable zap-in route|no single-token route/i.test(message)) {
    return "No route for this amount. Reduce amount or use balanced mode.";
  }

  if (
    /insufficient liquidity|insufficient reserves|insufficient output amount|0xbb55fd27|\bK\b|overflow|underflow/i.test(
      message,
    )
  ) {
    return "Pool liquidity is insufficient for this single-token amount.";
  }

  if (
    /insufficient amount[ab]?|insufficient amount[ab] desired|0x8f66ec14|0x34c90624|0xdc6b2ef2|0xacee0513|0x5945ea56/i.test(
      message,
    )
  ) {
    return "This single-token amount cannot be added at the current pool ratio. Try a smaller amount, higher slippage, or balanced mode.";
  }

  if (/deadline/i.test(message)) {
    return "Quote expired. Try again.";
  }

  return null;
}

function isApprovalPreflightEstimateError(message: string): boolean {
  return /allowance|0xfb8f41b2|transfer failed/i.test(message);
}

function isSameAddress(addressA: string, addressB: string): boolean {
  return addressA.toLowerCase() === addressB.toLowerCase();
}

async function validateZapRouteLiquidity({
  publicClient,
  routerAddress,
  routes,
  amountIn,
}: {
  publicClient: PublicClient;
  routerAddress: Address;
  routes: ZapRoute;
  amountIn: bigint;
}) {
  if (routes.length === 0 || amountIn === 0n) return;

  const amounts = (await publicClient.readContract({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [amountIn, routes],
  })) as bigint[];

  if (amounts.length !== routes.length + 1) {
    throw new Error("Unable to validate single-token route liquidity.");
  }

  await Promise.all(
    routes.map(async (route, index) => {
      const poolAddress = (await publicClient.readContract({
        address: route.factory,
        abi: FPMM_FACTORY_POOL_ABI,
        functionName: "getPool",
        args: [route.from, route.to],
      })) as Address;

      const [token0, [reserve0, reserve1]] = (await Promise.all([
        publicClient.readContract({
          address: poolAddress,
          abi: FPMM_ABI,
          functionName: "token0",
        }),
        publicClient.readContract({
          address: poolAddress,
          abi: FPMM_ABI,
          functionName: "getReserves",
        }),
      ])) as [Address, [bigint, bigint, bigint]];

      const reserveOut = isSameAddress(route.to, token0) ? reserve0 : reserve1;
      const amountOut = amounts[index + 1];

      // FPMM swaps require output to be strictly below available reserve.
      if (amountOut == null || amountOut >= reserveOut) {
        throw new Error(
          "Pool liquidity is insufficient for this single-token amount.",
        );
      }
    }),
  );
}

export function useZapInTransaction(pool: PoolDisplay, chainId?: ChainId) {
  const walletChainId = useChainId() as ChainId;
  const resolvedChainId = chainId ?? walletChainId;
  const publicClient = usePublicClient({ chainId: resolvedChainId });
  const queryClient = useQueryClient();

  const [buildResult, setBuildResult] = useState<ZapInTransaction | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [txHash, setTxHash] = useState<Address | undefined>();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  const {
    sendTransactionAsync,
    isPending: isSending,
    reset: resetSend,
  } = useSendTransaction();

  // Wait for receipt using publicClient directly (more reliable than useWaitForTransactionReceipt)
  const receiptWatcherRef = useRef(false);
  useEffect(() => {
    if (!txHash || !publicClient || receiptWatcherRef.current) return;

    receiptWatcherRef.current = true;
    setIsConfirming(true);
    setIsConfirmed(false);

    publicClient
      .waitForTransactionReceipt({ hash: txHash })
      .then((receipt) => {
        setIsConfirming(false);
        setIsConfirmed(true);

        if (receipt.status === "success") {
          showLiquiditySuccessToast({
            action: "added",
            token0Symbol: pool.token0.symbol,
            token1Symbol: pool.token1.symbol,
            txHash: receipt.transactionHash,
            chainId: resolvedChainId,
          });
          queryClient.invalidateQueries({
            queryKey: ["pools-list", resolvedChainId],
          });
          queryClient.invalidateQueries({ queryKey: ["readContract"] });
        } else {
          toast.error(
            "Single-token liquidity transaction reverted on-chain. Try increasing slippage or reducing the amount.",
          );
          logger.error("Zap-in transaction reverted:", receipt.transactionHash);
        }
      })
      .catch((err) => {
        setIsConfirming(false);
        logger.error("Error waiting for zap-in receipt:", err);
        toast.error("Failed to confirm single-token liquidity transaction.");
      });
  }, [txHash, publicClient, pool, resolvedChainId, queryClient]);

  const buildTransactionAttempt = useCallback(
    async (
      tokenIn: Address,
      amountIn: bigint,
      recipient: Address,
      slippage: SlippageOption,
    ): Promise<ZapInBuildAttempt> => {
      setIsBuilding(true);
      setBuildError(null);
      try {
        const sdk = await getMentoSdk(resolvedChainId);

        if (!publicClient) throw new Error("Public client not available");
        const block = await publicClient.getBlock();
        const deadline = block.timestamp + BigInt(20 * 60);

        const result = await sdk.liquidity.buildZapInTransaction({
          poolAddress: pool.poolAddr,
          tokenIn,
          amountIn,
          amountInSplit: 0.5,
          recipient,
          owner: recipient,
          options: { slippageTolerance: slippage, deadline },
        });

        try {
          await publicClient.estimateGas({
            account: recipient,
            to: result.zapIn.params.to as Address,
            data: result.zapIn.params.data as Hex,
            value: BigInt(result.zapIn.params.value || 0),
          });
        } catch (estimateErr) {
          const estimateMessage =
            estimateErr instanceof Error
              ? estimateErr.message
              : String(estimateErr);

          let parsedError = getZapInBuildError(estimateMessage);
          const canBeMissingAllowance =
            Boolean(result.approval) &&
            !parsedError &&
            isApprovalPreflightEstimateError(estimateMessage);

          if (canBeMissingAllowance) {
            try {
              await Promise.all([
                validateZapRouteLiquidity({
                  publicClient,
                  routerAddress: result.zapIn.params.to as Address,
                  routes: result.zapIn.routesA,
                  amountIn: result.zapIn.amountInA,
                }),
                validateZapRouteLiquidity({
                  publicClient,
                  routerAddress: result.zapIn.params.to as Address,
                  routes: result.zapIn.routesB,
                  amountIn: result.zapIn.amountInB,
                }),
              ]);
            } catch (validationErr) {
              const validationMessage =
                validationErr instanceof Error
                  ? validationErr.message
                  : String(validationErr);
              parsedError =
                getZapInBuildError(validationMessage) || validationMessage;
            }
          }

          // Missing allowance can surface as a generic transfer failure on
          // Monad. Waive only that recognized approval failure after the route
          // itself has passed read-only liquidity validation.
          if (canBeMissingAllowance && !parsedError) {
            setBuildResult(result);
            setBuildError(null);
            return { build: result, error: null };
          }

          const error =
            parsedError ||
            "This single-token amount cannot be simulated right now. Try a smaller amount, higher slippage, or balanced mode.";
          setBuildError(error);
          setBuildResult(null);
          return { build: null, error };
        }

        setBuildResult(result);
        setBuildError(null);
        return { build: result, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const parsedError = getZapInBuildError(message);
        const error =
          parsedError || "Unable to prepare single-token liquidity right now.";
        setBuildError(error);
        logger.error("Failed to build zap-in transaction:", err);
        setBuildResult(null);
        return { build: null, error };
      } finally {
        setIsBuilding(false);
      }
    },
    [resolvedChainId, pool, publicClient],
  );

  const buildTransaction = useCallback(
    async (
      tokenIn: Address,
      amountIn: bigint,
      recipient: Address,
      slippage: SlippageOption,
    ): Promise<ZapInTransaction | null> =>
      (await buildTransactionAttempt(tokenIn, amountIn, recipient, slippage))
        .build,
    [buildTransactionAttempt],
  );

  const sendZapIn = useCallback(
    async (build: ZapInTransaction) => {
      try {
        const hash = await sendTransactionAsync({
          to: build.zapIn.params.to as Address,
          data: build.zapIn.params.data as Hex,
          value: BigInt(build.zapIn.params.value || 0),
        });
        logger.info("Zap-in tx submitted:", hash);
        setTxHash(hash);
        return hash;
      } catch (err) {
        toast.error(
          getTransactionErrorMessage(
            err instanceof Error ? err.message : String(err),
            "Unable to complete single-token liquidity transaction.",
            "Add liquidity",
          ),
        );
        logger.error("Zap-in transaction failed:", err);
        throw err;
      }
    },
    [sendTransactionAsync],
  );

  const reset = useCallback(() => {
    setBuildResult(null);
    setBuildError(null);
    setTxHash(undefined);
    setIsConfirming(false);
    setIsConfirmed(false);
    receiptWatcherRef.current = false;
    resetSend();
  }, [resetSend]);

  return {
    buildTransaction,
    buildTransactionAttempt,
    buildResult,
    buildError,
    isBuilding,
    sendZapIn,
    isSending,
    isConfirming,
    isConfirmed,
    zapTxHash: txHash,
    reset,
  };
}
