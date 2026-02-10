import type { ChainId } from "@/config/chains";
import { getMentoSdk } from "@/features/sdk";
import { logger } from "@/utils/logger";
import { toast } from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import {
  useChainId,
  usePublicClient,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";
import type { PoolDisplay, SlippageOption, TransactionParams } from "../types";
import { getTransactionErrorMessage } from "../types";

interface ZapInBuildResult {
  approval: {
    token: string;
    amount: bigint;
    params: TransactionParams;
  } | null;
  zapIn: {
    params: TransactionParams;
    poolAddress: string;
    tokenIn: string;
    amountIn: bigint;
    amountInA: bigint;
    amountInB: bigint;
    expectedLiquidity: bigint;
  };
}

export function useZapInTransaction(pool: PoolDisplay) {
  const chainId = useChainId() as ChainId;
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();

  const [buildResult, setBuildResult] = useState<ZapInBuildResult | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [txHash, setTxHash] = useState<Address | undefined>();

  const {
    sendTransactionAsync,
    isPending: isSending,
    reset: resetSend,
  } = useSendTransaction();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const buildTransaction = useCallback(
    async (
      tokenIn: Address,
      amountIn: bigint,
      recipient: Address,
      slippage: SlippageOption,
    ): Promise<ZapInBuildResult | null> => {
      setIsBuilding(true);
      try {
        const sdk = await getMentoSdk(chainId);

        if (!publicClient) throw new Error("Public client not available");
        const block = await publicClient.getBlock();
        const deadline = block.timestamp + BigInt(20 * 60);

        const result = await sdk.liquidity.buildZapInTransaction(
          pool.poolAddr,
          tokenIn,
          amountIn,
          0.5,
          recipient,
          recipient,
          { slippageTolerance: slippage, deadline },
        );

        setBuildResult(result as unknown as ZapInBuildResult);
        return result as unknown as ZapInBuildResult;
      } catch (err) {
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
    async (build: ZapInBuildResult) => {
      try {
        const hash = await sendTransactionAsync({
          to: build.zapIn.params.to as Address,
          data: build.zapIn.params.data as Hex,
          value: BigInt(build.zapIn.params.value || 0),
        });
        setTxHash(hash);
        return hash;
      } catch (err) {
        toast.error(
          getTransactionErrorMessage(
            err instanceof Error ? err.message : String(err),
            "Unable to complete zap-in transaction.",
          ),
        );
        logger.error("Zap-in transaction failed:", err);
        throw err;
      }
    },
    [sendTransactionAsync],
  );

  // On confirmation: toast + invalidate queries
  useEffect(() => {
    if (isConfirmed && receipt?.status === "success") {
      toast.success(
        `Successfully added liquidity to ${pool.token0.symbol}/${pool.token1.symbol} pool.`,
      );

      queryClient.invalidateQueries({
        queryKey: ["pools-list", chainId],
      });
    }
  }, [isConfirmed, receipt, pool, chainId, queryClient]);

  const reset = useCallback(() => {
    setBuildResult(null);
    setTxHash(undefined);
    resetSend();
  }, [resetSend]);

  return {
    buildTransaction,
    buildResult,
    isBuilding,
    sendZapIn,
    isSending,
    isConfirming,
    isConfirmed,
    zapTxHash: txHash,
    reset,
  };
}
