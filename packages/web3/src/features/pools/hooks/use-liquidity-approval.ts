import { logger } from "@/utils/logger";
import { toast } from "@repo/ui";
import type { TokenApproval } from "@mento-protocol/mento-sdk";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { getTransactionErrorMessage } from "../types";

export function useLiquidityApproval(
  tokenSymbol: string,
  onApproved?: () => void,
) {
  const [txHash, setTxHash] = useState<Address | undefined>();
  const { sendTransactionAsync, isPending, reset } = useSendTransaction();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const onApprovedRef = useRef(onApproved);
  useEffect(() => {
    onApprovedRef.current = onApproved;
  }, [onApproved]);

  const hasFiredRef = useRef(false);
  useEffect(() => {
    if (isConfirmed && onApprovedRef.current && !hasFiredRef.current) {
      hasFiredRef.current = true;
      onApprovedRef.current();
    }
  }, [isConfirmed]);

  const sendApproval = async (approval: TokenApproval) => {
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
          `${tokenSymbol} approval`,
        ),
      );
      logger.error(`${tokenSymbol} approval failed:`, err);
      throw err;
    }
  };

  const resetApproval = () => {
    setTxHash(undefined);
    hasFiredRef.current = false;
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
