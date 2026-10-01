import { toast } from "@mento-protocol/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import type { PublicClient } from "viem";
import type { Config } from "wagmi";
import { getChainId, getPublicClient } from "wagmi/actions";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import type { AdjustTroveParams, CallParams, TroveStatus } from "../types";
import { executeFlow } from "../tx-flows/flow";
import { buildAdjustTroveCall } from "./adjust-trove-transaction";
import { useBorrowService } from "./use-borrow-service";
import { fetchTroveOwner, isTroveOwner } from "./use-trove-owner";

const NOT_OWNER_MESSAGE = "Only the owner of this position can adjust it.";
const OWNER_UNCONFIRMED_MESSAGE =
  "The owner of this position couldn't be confirmed. Please try again.";

interface AdjustTroveMutationParams {
  symbol: string;
  params: AdjustTroveParams;
  troveStatus: TroveStatus;
  wagmiConfig: Config;
  account: string;
  successHref?: string;
}

export function useAdjustTrove() {
  const sdk = useBorrowService();
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      params,
      troveStatus,
      wagmiConfig,
      account,
      successHref,
    }: AdjustTroveMutationParams) => {
      if (!sdk) throw new Error("Borrow service not available");

      // Only the trove's on-chain owner may start an adjustment.
      const chainId = getChainId(wagmiConfig);
      const publicClient = getPublicClient(wagmiConfig, { chainId });
      if (!publicClient) throw new Error("Public client not available");
      let owner: string;
      try {
        owner = await fetchTroveOwner(
          publicClient as PublicClient,
          chainId,
          symbol,
          BigInt(params.troveId),
        );
      } catch (error) {
        toast.error(OWNER_UNCONFIRMED_MESSAGE);
        throw error;
      }
      if (!isTroveOwner(owner, account)) {
        toast.error(NOT_OWNER_MESSAGE);
        throw new Error(NOT_OWNER_MESSAGE);
      }

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
              buildAdjustTroveCall(sdk, symbol, params, troveStatus),
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
      toast.success("Position adjusted successfully");
      queryClient.invalidateQueries({ queryKey: ["borrow", "userTroves"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "troveData"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "allowance"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "branchStats"] });
    },
  });
}
