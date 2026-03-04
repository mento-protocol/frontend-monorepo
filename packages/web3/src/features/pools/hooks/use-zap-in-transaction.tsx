import type { ChainId } from "@/config/chains";
import { getMentoSdk } from "@/features/sdk";
import { logger } from "@/utils/logger";
import { toast } from "@repo/ui";
import type { ZapInTransaction } from "@mento-protocol/mento-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useChainId, usePublicClient, useSendTransaction } from "wagmi";
import { showLiquiditySuccessToast } from "../liquidity-toast";
import type { PoolDisplay, SlippageOption } from "../types";
import { getTransactionErrorMessage } from "../types";

function getZapInBuildError(message: string): string | null {
  if (/no viable zap-in route/i.test(message)) {
    return "No route for this amount. Reduce amount or use balanced mode.";
  }

  if (
    /insufficient liquidity|insufficient reserves|insufficient output amount|\bK\b|overflow|underflow/i.test(
      message,
    )
  ) {
    return "Pool liquidity is insufficient for this single-token amount.";
  }

  if (/deadline/i.test(message)) {
    return "Quote expired. Try again.";
  }

  return null;
}

function isAllowanceError(message: string): boolean {
  return /allowance|insufficient allowance|exceeds allowance/i.test(message);
}

export function useZapInTransaction(pool: PoolDisplay) {
  const chainId = useChainId() as ChainId;
  const publicClient = usePublicClient({ chainId });
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
            chainId,
          });
          queryClient.invalidateQueries({
            queryKey: ["pools-list", chainId],
          });
          queryClient.invalidateQueries({ queryKey: ["readContract"] });
        } else {
          toast.error(
            "Zap-in transaction reverted on-chain. Try increasing slippage or reducing the amount.",
          );
          logger.error("Zap-in transaction reverted:", receipt.transactionHash);
        }
      })
      .catch((err) => {
        setIsConfirming(false);
        logger.error("Error waiting for zap-in receipt:", err);
        toast.error("Failed to confirm zap-in transaction.");
      });
  }, [txHash, publicClient, pool, chainId, queryClient]);

  const buildTransaction = useCallback(
    async (
      tokenIn: Address,
      amountIn: bigint,
      recipient: Address,
      slippage: SlippageOption,
    ): Promise<ZapInTransaction | null> => {
      setIsBuilding(true);
      setBuildError(null);
      try {
        const sdk = await getMentoSdk(chainId);

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
          const parsedError = getZapInBuildError(estimateMessage);

          // Allow pre-approval builds to proceed even though the zap call itself
          // may fail simulation due missing allowance.
          if (!(result.approval && isAllowanceError(estimateMessage))) {
            setBuildError(parsedError || "Route unavailable for this amount.");
            setBuildResult(null);
            return null;
          }
        }

        setBuildResult(result);
        setBuildError(null);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const parsedError = getZapInBuildError(message);
        setBuildError(
          parsedError || "Unable to prepare single-token liquidity right now.",
        );
        logger.error("Failed to build zap-in transaction:", err);
        setBuildResult(null);
        return null;
      } finally {
        setIsBuilding(false);
      }
    },
    [chainId, pool, publicClient],
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
            "Unable to complete zap-in transaction.",
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
