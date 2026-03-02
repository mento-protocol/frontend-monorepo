import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import type { Config } from "wagmi";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import { executeFlow } from "../tx-flows/engine";
import { useBorrowService } from "./use-borrow-service";

interface AdjustInterestRateMutationParams {
  symbol: string;
  troveId: string;
  newRate: bigint;
  maxUpfrontFee: bigint;
  wagmiConfig: Config;
  account: string;
}

export function useAdjustInterestRate() {
  const sdk = useBorrowService();
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      troveId,
      newRate,
      maxUpfrontFee,
      wagmiConfig,
      account,
    }: AdjustInterestRateMutationParams) => {
      if (!sdk) throw new Error("Borrow service not available");

      const flowId = `adjust-interest-rate-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Adjust Interest Rate",
        account,
        [
          {
            id: "adjust-rate",
            label: "Adjust Interest Rate",
            buildTx: async () =>
              sdk.buildAdjustInterestRateTransaction(
                symbol,
                troveId,
                newRate,
                maxUpfrontFee,
              ),
          },
        ],
      );

      if (!result.success) {
        throw new Error("Transaction flow failed");
      }

      return result;
    },
    onSuccess: () => {
      toast.success("Interest rate updated successfully");
      queryClient.invalidateQueries({ queryKey: ["borrow", "troveData"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "userTroves"] });
      queryClient.invalidateQueries({
        queryKey: ["borrow", "interestRateBrackets"],
      });
    },
  });
}
