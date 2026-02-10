import { logger } from "@/utils/logger";
import { toast } from "@repo/ui";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import type { TransactionParams } from "../types";
import { getTransactionErrorMessage } from "../types";

interface ApprovalInput {
  token: string;
  amount: bigint;
  params: TransactionParams;
}

export function useLiquidityApproval(tokenSymbol: string) {
  const [txHash, setTxHash] = useState<Address | undefined>();
  const { sendTransactionAsync, isPending, reset } = useSendTransaction();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const sendApproval = async (approval: ApprovalInput) => {
    try {
      const hash = await sendTransactionAsync({
        to: approval.params.to as Address,
        data: approval.params.data as Hex,
        value: BigInt(approval.params.value || 0),
      });
      setTxHash(hash);
      return hash;
    } catch (err) {
      toast.error(
        getTransactionErrorMessage(
          err instanceof Error ? err.message : String(err),
          "Unable to complete approval transaction.",
        ),
      );
      logger.error(`${tokenSymbol} approval failed:`, err);
      throw err;
    }
  };

  const resetApproval = () => {
    setTxHash(undefined);
    reset();
  };

  return {
    sendApproval,
    isApproving: isPending || isConfirming,
    isApproved: isConfirmed,
    approvalHash: txHash,
    reset: resetApproval,
  };
}
