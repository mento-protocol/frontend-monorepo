import {
  useWriteContract,
  useWaitForTransactionReceipt,
} from "@repo/web3/wagmi";
import { toast } from "@repo/ui";
import { parseAbi, type Address } from "viem";
import { useEffect } from "react";

const REBALANCE_ABI = parseAbi(["function rebalance(address pool) external"]);

interface TriggerRebalanceParams {
  strategyAddress: string;
  poolAddress: string;
}

export function useTriggerRebalance() {
  const {
    writeContract,
    data: hash,
    isPending: isWritePending,
  } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    if (isConfirmed) {
      if (receipt?.status !== "success") {
        toast.error("Rebalance transaction failed", {
          description: "The transaction was confirmed but reverted on-chain",
          duration: 5000,
        });
      } else {
        toast.success("Rebalance completed successfully", {
          duration: 3000,
        });
      }
    }
  }, [isConfirmed, receipt]);

  const triggerRebalance = ({
    strategyAddress,
    poolAddress,
  }: TriggerRebalanceParams) => {
    writeContract(
      {
        address: strategyAddress as Address,
        abi: REBALANCE_ABI,
        functionName: "rebalance",
        args: [poolAddress as Address],
      },
      {
        onError: (error) => {
          console.error("Rebalance error:", error);
          toast.error("Failed to trigger rebalance", {
            description: error.message,
            duration: 5000,
          });
        },
      },
    );
  };

  return {
    triggerRebalance,
    isPending: isWritePending || isConfirming,
    hash,
  };
}
