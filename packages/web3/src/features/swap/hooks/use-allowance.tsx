import { getPublicClient } from "@/features/sdk";
import {
  getContractAddress,
  getTokenAddress,
  TokenSymbol,
} from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { type Address, erc20Abi } from "viem";

async function fetchAllowance(
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
  accountAddress: string,
  chainId: number,
): Promise<string> {
  const tokenAddr = getTokenAddress(chainId, tokenInSymbol);
  if (!tokenAddr) {
    throw new Error(
      `${tokenInSymbol} token address not found on chain ${chainId}`,
    );
  }

  const routerAddress = getContractAddress(chainId, "Router");

  // For Debugging
  // logger.info(`Fetching allowance for token ${tokenAddr} on chain ${chainId}`);
  const publicClient = getPublicClient(chainId);
  const allowance = await publicClient.readContract({
    address: tokenAddr as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [accountAddress as Address, routerAddress as Address],
  });
  // For Debugging
  // logger.info(`Allowance: ${allowance.toString()}`);
  return allowance.toString();
}

export function useAppAllowance(
  chainId: number,
  tokenInSymbol: TokenSymbol | undefined,
  tokenOutSymbol: TokenSymbol | undefined,
  address?: string,
) {
  const {
    data: allowance,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [
      "tokenAllowance",
      chainId,
      tokenInSymbol,
      tokenOutSymbol,
      address,
    ],
    queryFn: async () => {
      if (!address || !tokenInSymbol || !tokenOutSymbol) return "0";
      return fetchAllowance(tokenInSymbol, tokenOutSymbol, address, chainId);
    },
    retry: false,
    enabled: Boolean(address && chainId && tokenInSymbol && tokenOutSymbol),
    staleTime: 5000, // Consider allowance stale after 5 seconds
  });

  return {
    allowance: allowance || "0",
    isLoading: isLoading || isFetching,
    refetchAllowance: refetch,
  };
}
