import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import type { Config } from "wagmi";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import { executeFlow } from "../tx-flows/engine";
import { useBorrowService } from "./use-borrow-service";

interface ClaimCollateralMutationParams {
  symbol: string;
  wagmiConfig: Config;
  account: string;
  successHref?: string;
}

export function useClaimCollateral() {
  const sdk = useBorrowService();
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      wagmiConfig,
      account,
      successHref,
    }: ClaimCollateralMutationParams) => {
      if (!sdk) throw new Error("Borrow service not available");

      const flowId = `claim-collateral-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Claim Collateral",
        account,
        [
          {
            id: "claim-collateral",
            label: "Claim Collateral",
            buildTx: async () => sdk.buildClaimCollateralTransaction(symbol),
          },
        ],
        { successHref },
      );

      if (!result.success) {
        throw new Error("Transaction flow failed");
      }

      return result;
    },
    onSuccess: () => {
      toast.success("Collateral claimed successfully");
      queryClient.invalidateQueries({ queryKey: ["borrow", "userTroves"] });
    },
  });
}
