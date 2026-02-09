import { logger } from "@/utils/logger";
import { toast } from "@repo/ui";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";

interface ApprovalInput {
  token: string;
  amount: bigint;
  params: { to: string; data: string; value: string };
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
      const message = getApprovalErrorMessage(
        err instanceof Error ? err.message : String(err),
      );
      toast.error(message);
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

function getApprovalErrorMessage(msg: string): string {
  if (
    /user\s+rejected/i.test(msg) ||
    /denied\s+transaction/i.test(msg) ||
    /request\s+rejected/i.test(msg)
  ) {
    return "Approval transaction rejected.";
  }
  if (/insufficient\s+funds/i.test(msg)) {
    return "Insufficient funds for approval.";
  }
  return "Unable to complete approval transaction.";
}
