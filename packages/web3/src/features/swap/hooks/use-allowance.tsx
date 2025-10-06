import { ERC20_ABI } from "@/config/constants";
import { getProvider } from "@/features/providers";
import { getTradablePairForTokens } from "@/features/sdk";
import {
  getAddress,
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
  const tradablePair = await getTradablePairForTokens(
    chainId,
    tokenInSymbol,
    tokenOutSymbol,
  );
  const brokerAddress = getAddress("Broker", chainId);
  const routerAddress = getAddress("MentoRouter", chainId);
  const tokenAddr = getTokenAddress(tokenInSymbol, chainId);
  if (!tokenAddr) {
    throw new Error(
      `${tokenInSymbol} token address not found on chain ${chainId}`,
    );
  }

  // For Debugging
  // logger.info(`Fetching allowance for token ${tokenAddr} on chain ${chainId}`);
  const provider = getProvider(chainId);
  const contract = new Contract(tokenAddr, ERC20_ABI, provider);

  let allowedContractAddr: string;
  if (tradablePair.path.length === 1) {
    allowedContractAddr = brokerAddress;
  } else {
    allowedContractAddr = routerAddress;
  }

  const allowance = await contract.allowance(
    accountAddress,
    allowedContractAddr,
  );
  // For Debugging
  // logger.info(`Allowance: ${allowance.toString()}`);
  return allowance.toString();
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
