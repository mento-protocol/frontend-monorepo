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

interface ApprovalResult {
  token: string;
  amount: bigint;
  params: TransactionParams;
}

interface RemoveLiquidityBuildResult {
  approval: ApprovalResult | null;
  removeLiquidity: {
    params: TransactionParams;
    poolAddress: string;
    token0: string;
    token1: string;
    liquidity: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    expectedAmount0: bigint;
    expectedAmount1: bigint;
    deadline: bigint;
  };
}

export function useRemoveLiquidityTransaction(pool: PoolDisplay) {
  const chainId = useChainId() as ChainId;
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();

  const [buildResult, setBuildResult] =
    useState<RemoveLiquidityBuildResult | null>(null);
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
      liquidity: bigint,
      recipient: Address,
      owner: Address,
      slippage: SlippageOption,
    ): Promise<RemoveLiquidityBuildResult | null> => {
      setIsBuilding(true);
      try {
        const sdk = await getMentoSdk(chainId);

        if (!publicClient) throw new Error("Public client not available");
        const block = await publicClient.getBlock();
        const deadline = block.timestamp + BigInt(20 * 60);

        const result = await sdk.liquidity.buildRemoveLiquidityTransaction(
          pool.poolAddr as Address,
          liquidity,
          recipient,
          owner,
          { slippageTolerance: slippage, deadline },
        );

        setBuildResult(result as unknown as RemoveLiquidityBuildResult);
        return result as unknown as RemoveLiquidityBuildResult;
      } catch (err) {
        logger.error("Failed to build remove liquidity transaction:", err);
        setBuildResult(null);
        return null;
      } finally {
        setIsBuilding(false);
      }
    },
    [chainId, pool, publicClient],
  );

  const sendRemoveLiquidity = useCallback(
    async (build: RemoveLiquidityBuildResult) => {
      try {
        const hash = await sendTransactionAsync({
          to: build.removeLiquidity.params.to as Address,
          data: build.removeLiquidity.params.data as Hex,
          value: BigInt(build.removeLiquidity.params.value || 0),
        });
        setTxHash(hash);
        return hash;
      } catch (err) {
        toast.error(
          getTransactionErrorMessage(
            err instanceof Error ? err.message : String(err),
            "Unable to complete remove liquidity transaction.",
          ),
        );
        logger.error("Remove liquidity transaction failed:", err);
        throw err;
      }
    },
    [sendTransactionAsync],
  );

  useEffect(() => {
    if (isConfirmed && receipt?.status === "success") {
      toast.success(
        `Successfully removed liquidity from ${pool.token0.symbol}/${pool.token1.symbol} pool.`,
      );

      queryClient.invalidateQueries({
        queryKey: ["pools-list", chainId],
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          JSON.stringify(query.queryKey).toLowerCase().includes("balanceof"),
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
    sendRemoveLiquidity,
    isSending,
    isConfirming,
    isConfirmed,
    removeTxHash: txHash,
    reset,
  };
}
