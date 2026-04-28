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
import {
  buildSpClaimAllCollGains,
  buildSpWithdraw,
} from "../stability-pool/tx-builders";

interface SpClaimRewardsMutationParams {
  symbol: string;
  hasDeposit: boolean;
  wagmiConfig: Config;
  account: string;
}

export function useSpClaimRewards() {
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      hasDeposit,
      wagmiConfig,
      account,
    }: SpClaimRewardsMutationParams) => {
      const chainId = getChainId(wagmiConfig);
      const publicClient = getPublicClient(wagmiConfig);
      if (!publicClient) throw new Error("Public client not available");

      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient,
        registryAddress,
      );
      const spAddress = addresses.stabilityPool as string;

      const flowId = `sp-claim-rewards-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Claim Stability Pool Rewards",
        account,
        [
          {
            id: "sp-claim-rewards",
            label: "Claim rewards",
            buildTx: async () =>
              hasDeposit
                ? buildSpWithdraw(spAddress, 0n, true)
                : buildSpClaimAllCollGains(spAddress),
          },
        ],
      );

      if (!result.success) {
        throw new Error("Transaction flow failed");
      }

      return result;
    },
    onSuccess: () => {
      toast.success("Rewards claimed successfully");
      queryClient.invalidateQueries({
        queryKey: ["borrow", "stabilityPool"],
      });
      queryClient.invalidateQueries({
        queryKey: ["borrow", "stabilityPoolStats"],
      });
    },
  });
}
