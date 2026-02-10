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

interface BuildResult {
  approvalA: ApprovalResult | null;
  approvalB: ApprovalResult | null;
  addLiquidity: {
    params: TransactionParams;
    expectedLiquidity: bigint;
    amountADesired: bigint;
    amountBDesired: bigint;
    amountAMin: bigint;
    amountBMin: bigint;
    deadline: bigint;
  };
}

export function useAddLiquidityTransaction(pool: PoolDisplay) {
  const chainId = useChainId() as ChainId;
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();

  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
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
      amountA: bigint,
      amountB: bigint,
      recipient: Address,
      slippage: SlippageOption,
    ): Promise<BuildResult | null> => {
      setIsBuilding(true);
      try {
        const sdk = await getMentoSdk(chainId);

        if (!publicClient) throw new Error("Public client not available");
        const block = await publicClient.getBlock();
        const deadline = block.timestamp + BigInt(20 * 60);

        const result = await sdk.liquidity.buildAddLiquidityTransaction(
          pool.poolAddr as Address,
          pool.token0.address as Address,
          amountA,
          pool.token1.address as Address,
          amountB,
          recipient,
          recipient,
          { slippageTolerance: slippage, deadline },
        );

        setBuildResult(result as unknown as BuildResult);
        return result as unknown as BuildResult;
      } catch (err) {
        logger.error("Failed to build add liquidity transaction:", err);
        setBuildResult(null);
        return null;
      } finally {
        setIsBuilding(false);
      }
    },
    [chainId, pool, publicClient],
  );

  const sendAddLiquidity = useCallback(
    async (build: BuildResult) => {
      try {
        const hash = await sendTransactionAsync({
          to: build.addLiquidity.params.to as Address,
          data: build.addLiquidity.params.data as Hex,
          value: BigInt(build.addLiquidity.params.value || 0),
        });
        setTxHash(hash);
        return hash;
      } catch (err) {
        toast.error(
          getTransactionErrorMessage(
            err instanceof Error ? err.message : String(err),
            "Unable to complete add liquidity transaction.",
          ),
        );
        logger.error("Add liquidity transaction failed:", err);
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
    sendAddLiquidity,
    isSending,
    isConfirming,
    isConfirmed,
    addTxHash: txHash,
    reset,
  };
}
