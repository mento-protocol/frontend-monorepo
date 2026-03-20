import { toast } from "@repo/ui";
import {
  getBorrowRegistry,
  resolveAddressesFromRegistry,
} from "@mento-protocol/mento-sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { erc20Abi, type Address } from "viem";
import type { Config } from "wagmi";
import { getChainId, getPublicClient } from "wagmi/actions";
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
            id: "approve-gas-compensation",
            label: "Approve Gas Compensation",
            buildTx: async (): Promise<CallParams | null> => {
              const [{ ethGasCompensation }, gasAllowance] = await Promise.all([
                sdk.getSystemParams(symbol),
                sdk.getGasTokenAllowance(symbol, params.owner),
              ]);

              if (gasAllowance >= ethGasCompensation) return null;
              return sdk.buildGasCompensationApprovalParams(
                symbol,
                ethGasCompensation,
              );
            },
          },
          {
            id: "open-trove",
            label: "Open Position",
            buildTx: async () => {
              const chainId = getChainId(wagmiConfig);
              const publicClient = getPublicClient(wagmiConfig);
              if (!publicClient) {
                throw new Error("Public client not available");
              }

              const registryAddress = getBorrowRegistry(chainId, symbol);
              const addresses = await resolveAddressesFromRegistry(
                publicClient,
                registryAddress,
              );
              const { ethGasCompensation } = await sdk.getSystemParams(symbol);

              const [collateralBalance, gasTokenBalance] = await Promise.all([
                publicClient.readContract({
                  address: addresses.collToken as Address,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [params.owner as Address],
                }),
                publicClient.readContract({
                  address: addresses.gasToken as Address,
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [params.owner as Address],
                }),
              ]);

              if (collateralBalance < params.collAmount) {
                throw new Error(
                  `Insufficient collateral balance: required ${params.collAmount.toString()}, available ${collateralBalance.toString()}`,
                );
              }

              if (gasTokenBalance < ethGasCompensation) {
                throw new Error(
                  `Insufficient gas token balance for compensation: required ${ethGasCompensation.toString()}, available ${gasTokenBalance.toString()}`,
                );
              }

              return sdk.buildOpenTroveTransaction(symbol, params);
            },
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
