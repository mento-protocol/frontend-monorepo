import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import type { Config } from "wagmi";
import { getChainId, getPublicClient } from "wagmi/actions";
import {
  getBorrowRegistry,
  resolveAddressesFromRegistry,
} from "@mento-protocol/mento-sdk";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import { executeFlow } from "../tx-flows/engine";
import { buildSpWithdraw } from "../stability-pool/tx-builders";

interface SpWithdrawMutationParams {
  symbol: string;
  amount: bigint;
  doClaim: boolean;
  wagmiConfig: Config;
  account: string;
}

export function useSpWithdraw() {
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      amount,
      doClaim,
      wagmiConfig,
      account,
    }: SpWithdrawMutationParams) => {
      // Resolve Stability Pool address
      const chainId = getChainId(wagmiConfig);
      const publicClient = getPublicClient(wagmiConfig);
      if (!publicClient) throw new Error("Public client not available");
      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient,
        registryAddress,
      );
      const spAddress = addresses.stabilityPool as string;

      const flowId = `sp-withdraw-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Stability Pool Withdrawal",
        account,
        [
          {
            id: "sp-withdraw",
            label: "Withdraw from Stability Pool",
            buildTx: async () => buildSpWithdraw(spAddress, amount, doClaim),
          },
        ],
      );

      if (!result.success) {
        throw new Error("Transaction flow failed");
      }

      return result;
    },
    onSuccess: () => {
      toast.success("Withdrawn from Stability Pool successfully");
      queryClient.invalidateQueries({
        queryKey: ["borrow", "stabilityPool"],
      });
      queryClient.invalidateQueries({
        queryKey: ["borrow", "stabilityPoolStats"],
      });
    },
  });
}
