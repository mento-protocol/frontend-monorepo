import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import type { Config } from "wagmi";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import type { AdjustTroveParams, CallParams } from "../types";
import { executeFlow } from "../tx-flows/engine";
import { useBorrowService } from "./use-borrow-service";

interface AdjustTroveMutationParams {
  symbol: string;
  params: AdjustTroveParams;
  wagmiConfig: Config;
  account: string;
}

export function useAdjustTrove() {
  const sdk = useBorrowService();
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      params,
      wagmiConfig,
      account,
    }: AdjustTroveMutationParams) => {
      if (!sdk) throw new Error("Borrow service not available");

      const flowId = `adjust-trove-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Adjust Position",
        account,
        [
          {
            id: "approve-collateral",
            label: "Approve Collateral",
            buildTx: async (): Promise<CallParams | null> => {
              if (!params.isCollIncrease || params.collChange === 0n)
                return null;
              const allowance = await sdk.getCollateralAllowance(
                symbol,
                account,
              );
              if (allowance >= params.collChange) return null;
              return sdk.buildCollateralApprovalParams(
                symbol,
                params.collChange,
              );
            },
          },
          {
            id: "adjust-trove",
            label: "Adjust Position",
            buildTx: async () =>
              sdk.buildAdjustTroveTransaction(symbol, params),
          },
        ],
      );

      if (!result.success) {
        throw new Error("Transaction flow failed");
      }

      return result;
    },
    onSuccess: () => {
      toast.success("Position adjusted successfully");
      queryClient.invalidateQueries({ queryKey: ["borrow", "userTroves"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "troveData"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "allowance"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "branchStats"] });
    },
  });
}
