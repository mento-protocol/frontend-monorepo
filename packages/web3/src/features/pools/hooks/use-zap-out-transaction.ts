import type { ChainId } from "@/config/chains";
import { getMentoSdk } from "@/features/sdk";
import { logger } from "@/utils/logger";
import { toast } from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useChainId, usePublicClient, useSendTransaction } from "wagmi";
import type { PoolDisplay, SlippageOption, TransactionParams } from "../types";
import { getTransactionErrorMessage } from "../types";

interface ZapOutBuildResult {
  approval: {
    token: string;
    amount: bigint;
    params: TransactionParams;
  } | null;
  zapOut: {
    params: TransactionParams;
    poolAddress: string;
    tokenOut: string;
    liquidity: bigint;
    expectedTokenOut: bigint;
  };
}

export function useZapOutTransaction(pool: PoolDisplay) {
  const chainId = useChainId() as ChainId;
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();

  const [buildResult, setBuildResult] = useState<ZapOutBuildResult | null>(
    null,
  );
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
          toast.success(
            `Successfully removed liquidity from ${pool.token0.symbol}/${pool.token1.symbol} pool.`,
          );
          queryClient.invalidateQueries({
            queryKey: ["pools-list", chainId],
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
  }, [txHash, publicClient, pool, chainId, queryClient]);

  const buildTransaction = useCallback(
    async (
      tokenOut: Address,
      liquidity: bigint,
      recipient: Address,
      slippage: SlippageOption,
    ): Promise<ZapOutBuildResult | null> => {
      setIsBuilding(true);
      try {
        const sdk = await getMentoSdk(chainId);

        if (!publicClient) throw new Error("Public client not available");
        const block = await publicClient.getBlock();
        const deadline = block.timestamp + BigInt(20 * 60);

        const result = await sdk.liquidity.buildZapOutTransaction(
          pool.poolAddr,
          tokenOut,
          liquidity,
          recipient,
          recipient,
          { slippageTolerance: slippage, deadline },
        );

        setBuildResult(result as unknown as ZapOutBuildResult);
        return result as unknown as ZapOutBuildResult;
      } catch (err) {
        logger.error("Failed to build zap-out transaction:", err);
        setBuildResult(null);
        return null;
      } finally {
        setIsBuilding(false);
      }
    },
    [chainId, pool, publicClient],
  );

  const sendZapOut = useCallback(
    async (build: ZapOutBuildResult) => {
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
    setTxHash(undefined);
    setIsConfirming(false);
    setIsConfirmed(false);
    receiptWatcherRef.current = false;
    resetSend();
  }, [resetSend]);

  return {
    buildTransaction,
    buildResult,
    isBuilding,
    sendZapOut,
    isSending,
    isConfirming,
    isConfirmed,
    zapOutTxHash: txHash,
    reset,
  };
}
