import type { ChainId } from "@/config/chains";
import { getMentoSdk } from "@/features/sdk";
import { logger } from "@/utils/logger";
import { toast } from "@repo/ui";
import type { ZapOutTransaction } from "@mento-protocol/mento-sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useChainId, usePublicClient, useSendTransaction } from "wagmi";
import { showLiquiditySuccessToast } from "../liquidity-toast";
import type { PoolDisplay, SlippageOption } from "../types";
import { getTransactionErrorMessage } from "../types";

function getZapOutBuildError(message: string): string {
  if (/no viable zap-out route|route not found|no route/i.test(message)) {
    return "No route for this amount. Reduce amount or use balanced mode.";
  }

  if (
    /execution reverted|call execution error|insufficient liquidity|insufficient reserves|insufficient output amount|bb55fd27|insufficientliquidity/i.test(
      message,
    )
  ) {
    return "No viable zap-out route for this amount. Reduce amount or use balanced mode.";
  }

  return "Unable to prepare single-token removal right now.";
}

export function useZapOutTransaction(pool: PoolDisplay, chainId?: ChainId) {
  const walletChainId = useChainId() as ChainId;
  const resolvedChainId = chainId ?? walletChainId;
  const publicClient = usePublicClient({ chainId: resolvedChainId });
  const queryClient = useQueryClient();

  const [buildResult, setBuildResult] = useState<ZapOutTransaction | null>(
    null,
  );
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

  // Wait for receipt using publicClient directly (more reliable for zap txs)
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
            action: "removed",
            token0Symbol: pool.token0.symbol,
            token1Symbol: pool.token1.symbol,
            txHash: receipt.transactionHash,
            chainId: resolvedChainId,
          });
          queryClient.invalidateQueries({
            queryKey: ["pools-list", resolvedChainId],
          });
          queryClient.invalidateQueries({
            predicate: (query) =>
              JSON.stringify(query.queryKey)
                .toLowerCase()
                .includes("balanceof"),
          });
        } else {
          toast.error(
            "Zap-out transaction reverted on-chain. Try increasing slippage or reducing the amount.",
          );
          logger.error(
            "Zap-out transaction reverted:",
            receipt.transactionHash,
          );
        }
      })
      .catch((err) => {
        setIsConfirming(false);
        logger.error("Error waiting for zap-out receipt:", err);
        toast.error("Failed to confirm zap-out transaction.");
      });
  }, [txHash, publicClient, pool, resolvedChainId, queryClient]);

  const buildTransaction = useCallback(
    async (
      tokenOut: Address,
      liquidity: bigint,
      recipient: Address,
      slippage: SlippageOption,
    ): Promise<ZapOutTransaction | null> => {
      setIsBuilding(true);
      setBuildError(null);
      try {
        const sdk = await getMentoSdk(resolvedChainId);

        if (!publicClient) throw new Error("Public client not available");
        const block = await publicClient.getBlock();
        const deadline = block.timestamp + BigInt(20 * 60);

        const result = await sdk.liquidity.buildZapOutTransaction({
          poolAddress: pool.poolAddr,
          tokenOut,
          liquidity,
          recipient,
          owner: recipient,
          options: { slippageTolerance: slippage, deadline },
        });

        setBuildResult(result);
        setBuildError(null);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setBuildError(getZapOutBuildError(message));
        logger.error("Failed to build zap-out transaction:", err);
        setBuildResult(null);
        return null;
      } finally {
        setIsBuilding(false);
      }
    },
    [resolvedChainId, pool, publicClient],
  );

  const sendZapOut = useCallback(
    async (build: ZapOutTransaction) => {
      try {
        const hash = await sendTransactionAsync({
          to: build.zapOut.params.to as Address,
          data: build.zapOut.params.data as Hex,
          value: BigInt(build.zapOut.params.value || 0),
        });
        logger.info("Zap-out tx submitted:", hash);
        setTxHash(hash);
        return hash;
      } catch (err) {
        toast.error(
          getTransactionErrorMessage(
            err instanceof Error ? err.message : String(err),
            "Unable to complete zap-out transaction.",
            "Remove liquidity",
          ),
        );
        logger.error("Zap-out transaction failed:", err);
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
    sendZapOut,
    isSending,
    isConfirming,
    isConfirmed,
    zapOutTxHash: txHash,
    reset,
  };
}
