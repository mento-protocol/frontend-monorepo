import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import type { Config } from "wagmi";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import type { CallParams, OpenTroveParams } from "../types";
import { executeFlow } from "../tx-flows/engine";
import { useBorrowService } from "./use-borrow-service";

interface OpenTroveMutationParams {
  symbol: string;
  params: OpenTroveParams;
  wagmiConfig: Config;
}

export function useOpenTrove() {
  const sdk = useBorrowService();
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      params,
      wagmiConfig,
    }: OpenTroveMutationParams) => {
      if (!sdk) throw new Error("Borrow service not available");

      const flowId = `open-trove-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Open Position",
        params.owner,
        [
          {
            id: "approve-collateral",
            label: "Approve Collateral",
            buildTx: async (): Promise<CallParams | null> => {
              const allowance = await sdk.getCollateralAllowance(
                symbol,
                params.owner,
              );
              if (allowance >= params.collAmount) return null;
              return sdk.buildCollateralApprovalParams(
                symbol,
                params.collAmount,
              );
            },
          },
          {
            id: "open-trove",
            label: "Open Position",
            buildTx: async () => sdk.buildOpenTroveTransaction(symbol, params),
          },
        ],
      );

      if (!result.success) {
        throw new Error("Transaction flow failed");
      }

      return result;
    },
    onSuccess: () => {
      toast.success("Position opened successfully");
      queryClient.invalidateQueries({ queryKey: ["borrow", "userTroves"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "allowance"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "branchStats"] });
    },
  });
}
