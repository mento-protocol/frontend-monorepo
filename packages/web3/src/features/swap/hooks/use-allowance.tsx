import { getAddress } from "@mento-protocol/mento-sdk";
import { useQuery } from "@tanstack/react-query";
import { Contract } from "ethers";
import { ERC20_ABI } from "@/config/constants";
import { TokenId, getTokenAddress } from "@/config/tokens";
import { getProvider } from "@/features/providers";
import { getTradablePairForTokens } from "@/features/sdk";

async function fetchAllowance(
  tokenInId: TokenId,
  tokenOutId: TokenId,
  accountAddress: string,
  chainId: number,
): Promise<string> {
  const tradablePair = await getTradablePairForTokens(
    chainId,
    tokenInId,
    tokenOutId,
  );
  const brokerAddress = getAddress("Broker", chainId);
  const routerAddress = getAddress("MentoRouter", chainId);
  const tokenAddr = getTokenAddress(tokenInId, chainId);

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
  tokenInId: TokenId,
  tokenOutId: TokenId,
  address?: string,
) {
  const { data: allowance, isLoading } = useQuery({
    queryKey: ["tokenAllowance", chainId, tokenInId, tokenOutId, address],
    queryFn: async () => {
      if (!address) return "0";
      return fetchAllowance(tokenInId, tokenOutId, address, chainId);
    },
    retry: false,
    enabled: Boolean(address && chainId && tokenInId && tokenOutId),
    staleTime: 5000, // Consider allowance stale after 5 seconds
  });

  return {
    allowance: allowance || "0",
    isLoading,
  };
}
