import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { maxUint256 } from "viem";
import type { Config } from "wagmi";
import { getChainId, getPublicClient } from "wagmi/actions";
import { getBorrowRegistry } from "@mento-protocol/mento-sdk";
import { resolveAddressesFromRegistry } from "@mento-protocol/mento-sdk";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import type { CallParams } from "../types";
import { executeFlow } from "../tx-flows/engine";
import { useBorrowService } from "./use-borrow-service";

interface CloseTroveMutationParams {
  symbol: string;
  troveId: string;
  debt: bigint;
  wagmiConfig: Config;
  account: string;
  successHref?: string;
}

export function useCloseTrove() {
  const sdk = useBorrowService();
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      troveId,
      debt,
      wagmiConfig,
      account,
      successHref,
    }: CloseTroveMutationParams) => {
      if (!sdk) throw new Error("Borrow service not available");

      // Resolve BorrowerOperations address (spender for debt token approval)
      const chainId = getChainId(wagmiConfig);
      const publicClient = getPublicClient(wagmiConfig);
      if (!publicClient) throw new Error("Public client not available");
      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient,
        registryAddress,
      );
      const borrowerOps = addresses.borrowerOperations;

      const flowId = `close-trove-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Close Position",
        account,
        [
          {
            id: "approve-debt",
            label: "Approve Debt Token",
            buildTx: async (): Promise<CallParams | null> => {
              const allowance = await sdk.getDebtAllowance(
                symbol,
                account,
                borrowerOps,
              );
              if (allowance >= debt) return null;
              return sdk.buildDebtApprovalParams(
                symbol,
                borrowerOps,
                maxUint256,
              );
            },
          },
          {
            id: "close-trove",
            label: "Close Position",
            buildTx: async () =>
              sdk.buildCloseTroveTransaction(symbol, troveId),
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
      toast.success("Position closed successfully");
      queryClient.invalidateQueries({ queryKey: ["borrow", "userTroves"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "troveData"] });
      queryClient.invalidateQueries({ queryKey: ["borrow", "branchStats"] });
    },
  });
}
