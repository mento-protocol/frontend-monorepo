import { getAddress } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { ERC20_ABI } from "@/lib/config/consts";
import { TokenId, getTokenAddress } from "@/lib/config/tokens";
import { getProvider } from "@/features/providers";
import { getTradablePairForTokens } from "@/features/sdk";

async function fetchAllowance(
  fromTokenId: TokenId,
  toTokenId: TokenId,
  accountAddress: string,
  chainId: number,
): Promise<string> {
  const tradablePair = await getTradablePairForTokens(
    chainId,
    fromTokenId,
    toTokenId,
  );
  const brokerAddress = getAddress("Broker", chainId);
  const routerAddress = getAddress("MentoRouter", chainId);
  const tokenAddr = getTokenAddress(fromTokenId, chainId);

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

export function useAllowance(
  chainId: number,
  fromTokenId: TokenId,
  toTokenId: TokenId,
  address?: string,
) {
  const { data: allowance, isLoading } = useQuery(
    ["tokenAllowance", chainId, fromTokenId, toTokenId, address],
    async () => {
      if (!address) return "0";
      return fetchAllowance(fromTokenId, toTokenId, address, chainId);
    },
    {
      retry: false,
      enabled: Boolean(address && chainId && fromTokenId && toTokenId),
      staleTime: 5000, // Consider allowance stale after 5 seconds
    },
  );

  return {
    allowance: allowance || "0",
    isLoading,
  };
}
