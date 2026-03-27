import { ERC20_ABI } from "@/config/constants";
import { getProvider } from "@/features/providers";
import {
  getContractAddress,
  getTokenAddress,
  TokenSymbol,
} from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";

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

  const provider = getProvider(chainId);
  const contract = new Contract(tokenAddr, ERC20_ABI, provider);

  try {
    const allowance = await contract.allowance(accountAddress, routerAddress);
    return allowance.toString();
  } catch (error) {
    // Ethers.js can throw plain objects ({code, data, message}) for RPC errors.
    // Wrap them so callers always receive proper Error instances, preventing
    // Sentry from capturing transient "unhandled" rejections before React Query
    // has a chance to process them.
    if (error instanceof Error) throw error;
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : `Failed to fetch allowance for ${tokenInSymbol}`;
    throw new Error(message);
  }
}

export function useAppAllowance(
  chainId: number,
  tokenInSymbol: TokenSymbol,
  tokenOutSymbol: TokenSymbol,
  address?: string,
) {
  const { data: allowance, isLoading } = useQuery({
    queryKey: [
      "tokenAllowance",
      chainId,
      tokenInSymbol,
      tokenOutSymbol,
      address,
    ],
    queryFn: async () => {
      if (!address) return "0";
      return fetchAllowance(tokenInSymbol, tokenOutSymbol, address, chainId);
    },
    retry: false,
    enabled: Boolean(address && chainId && tokenInSymbol && tokenOutSymbol),
    staleTime: 5000, // Consider allowance stale after 5 seconds
  });

  return {
    allowance: allowance || "0",
    isLoading,
  };
}
