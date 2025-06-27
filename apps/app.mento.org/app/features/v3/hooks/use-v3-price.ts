import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { celo, celoAlfajores } from "viem/chains";

// V3 Addresses Registry ABI (minimal for getting price feed address)
const ADDRESSES_REGISTRY_ABI = parseAbi([
  "function priceFeed() view returns (address)",
]);

// Price Feed ABI (minimal for getting price)
const PRICE_FEED_ABI = parseAbi(["function getPrice() view returns (uint256)"]);

// Contract addresses for V3 (from your basic UI config)
const V3_ADDRESSES_REGISTRY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0xd39c90bb4c1e5d63f83a9fe52359897bb1068ed3",
};

export function useV3Price() {
  const chainId = useChainId();

  return useQuery({
    queryKey: ["v3Price", chainId],
    queryFn: async () => {
      if (!chainId) throw new Error("Chain ID not available");

      const registryAddress =
        V3_ADDRESSES_REGISTRY[chainId as keyof typeof V3_ADDRESSES_REGISTRY];
      if (
        !registryAddress ||
        registryAddress === "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error(`V3 registry not deployed on chain ${chainId}`);
      }

      // Create public client for the current chain
      const publicClient = createPublicClient({
        chain: chainId === celo.id ? celo : celoAlfajores,
        transport: http(),
      });

      // Get price feed address from registry
      const priceFeedAddress = await publicClient.readContract({
        address: registryAddress as `0x${string}`,
        abi: ADDRESSES_REGISTRY_ABI,
        functionName: "priceFeed",
      });

      // Get price from price feed
      const priceWei = await publicClient.readContract({
        address: priceFeedAddress,
        abi: PRICE_FEED_ABI,
        functionName: "getPrice",
      });

      // Format price from 18 decimals to number
      const priceFormatted = formatUnits(priceWei, 18);

      return {
        price: parseFloat(priceFormatted),
        priceFormatted: `$${parseFloat(priceFormatted).toFixed(2)}`,
        timestamp: Date.now(),
      };
    },
    enabled:
      !!chainId &&
      !!V3_ADDRESSES_REGISTRY[chainId as keyof typeof V3_ADDRESSES_REGISTRY],
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Refetch every 30 seconds
    retry: 3,
    refetchOnWindowFocus: true,
  });
}
