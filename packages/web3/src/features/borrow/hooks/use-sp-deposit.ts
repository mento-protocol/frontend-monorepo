import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { maxUint256 } from "viem";
import type { Config } from "wagmi";
import { getChainId, getPublicClient } from "wagmi/actions";
import { getBorrowRegistry } from "@mento-protocol/mento-sdk";
import { resolveAddressesFromRegistry } from "@mento-protocol/mento-sdk/dist/services/borrow/borrowHelpers";
import { borrowFlowAtom } from "../atoms/flow-atoms";
import type { CallParams } from "../types";
import { executeFlow } from "../tx-flows/engine";
import { buildSpDeposit } from "../stability-pool/tx-builders";
import { useBorrowService } from "./use-borrow-service";

interface SpDepositMutationParams {
  symbol: string;
  amount: bigint;
  doClaim: boolean;
  wagmiConfig: Config;
  account: string;
}

export function useSpDeposit() {
  const sdk = useBorrowService();
  const setFlowAtom = useSetAtom(borrowFlowAtom);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      symbol,
      amount,
      doClaim,
      wagmiConfig,
      account,
    }: SpDepositMutationParams) => {
      if (!sdk) throw new Error("Borrow service not available");

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

      const flowId = `sp-deposit-${Date.now()}`;
      const result = await executeFlow(
        wagmiConfig,
        setFlowAtom,
        flowId,
        "Stability Pool Deposit",
        account,
        [
          {
            id: "approve-debt",
            label: "Approve Debt Token",
            buildTx: async (): Promise<CallParams | null> => {
              const allowance = await sdk.getDebtAllowance(
                symbol,
                account,
                spAddress,
              );
              if (allowance >= amount) return null;
              return sdk.buildDebtApprovalParams(symbol, spAddress, maxUint256);
            },
          },
          {
            id: "sp-deposit",
            label: "Deposit to Stability Pool",
            buildTx: async () => buildSpDeposit(spAddress, amount, doClaim),
          },
        ],
      );

      if (!result.success) {
        throw new Error("Transaction flow failed");
      }

      return result;
    },
    onSuccess: () => {
      toast.success("Deposited to Stability Pool successfully");
      queryClient.invalidateQueries({
        queryKey: ["borrow", "stabilityPool"],
      });
      queryClient.invalidateQueries({
        queryKey: ["borrow", "stabilityPoolStats"],
      });
    },
  });
}
