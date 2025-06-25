import { useQuery } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { celo, celoAlfajores } from "viem/chains";

// V3 Addresses Registry ABI
const ADDRESSES_REGISTRY_ABI = parseAbi([
  "function troveManager() view returns (address)",
]);

// Trove Manager ABI
const TROVE_MANAGER_ABI = parseAbi([
  "function getTroveIdsCount() view returns (uint256)",
  "function getTroveFromTroveIdsArray(uint256 _index) view returns (uint256)",
  "function Troves(uint256 _id) view returns (uint256 debt, uint256 coll, uint256 stake, uint8 status, uint64 arrayIndex, uint64 lastDebtUpdateTime, uint64 lastInterestRateAdjTime, uint256 annualInterestRate, address interestBatchManager, uint256 batchDebtShares)",
]);

// Contract addresses for V3
const V3_ADDRESSES_REGISTRY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0xf9bc8b3a0fb0ed51e2c4339849ca96b0ba7a69a4",
};

export interface V3Trove {
  id: string;
  debt: string;
  collateral: string;
  interestRate: string;
  liquidationPrice: string;
  collateralizationRatio: string;
  collateralizationValue: number;
  status: number;
}

export function useV3Troves() {
  const { address } = useAccount();
  const chainId = useChainId();

  return useQuery({
    queryKey: ["v3Troves", address, chainId],
    queryFn: async (): Promise<V3Trove[]> => {
      if (!address || !chainId) {
        return [];
      }

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

      // Get trove manager address from registry
      const troveManagerAddress = await publicClient.readContract({
        address: registryAddress as `0x${string}`,
        abi: ADDRESSES_REGISTRY_ABI,
        functionName: "troveManager",
      });

      // Get total number of troves
      const troveCount = await publicClient.readContract({
        address: troveManagerAddress,
        abi: TROVE_MANAGER_ABI,
        functionName: "getTroveIdsCount",
      });

      const troves: V3Trove[] = [];

      // Fetch all troves
      // TODO: In real implementation, we'd want to filter by user ownership
      for (let i = 0; i < Number(troveCount); i++) {
        try {
          // Get trove ID
          const troveId = await publicClient.readContract({
            address: troveManagerAddress,
            abi: TROVE_MANAGER_ABI,
            functionName: "getTroveFromTroveIdsArray",
            args: [BigInt(i)],
          });

          // Get trove data
          const troveData = await publicClient.readContract({
            address: troveManagerAddress,
            abi: TROVE_MANAGER_ABI,
            functionName: "Troves",
            args: [troveId],
          });

          const [debt, coll, , status, , , , annualInterestRate] = troveData;

          // Calculate collateralization ratio (assuming 1:1 price for demo)
          // TODO: Get actual price from oracle
          const debtNumber = parseFloat(formatUnits(debt, 18));
          const collNumber = parseFloat(formatUnits(coll, 18));
          const cratio = collNumber > 0 ? (collNumber / debtNumber) * 100 : 0;

          troves.push({
            id: troveId.toString(),
            debt: formatUnits(debt, 18),
            collateral: formatUnits(coll, 18),
            interestRate: formatUnits(annualInterestRate, 16), // Convert from basis points
            liquidationPrice: ((debtNumber * 1.1) / collNumber).toFixed(4), // Rough calculation
            collateralizationRatio: cratio.toFixed(2),
            collateralizationValue: cratio,
            status: Number(status),
          });
        } catch (error) {
          console.error(`Error loading trove ${i}:`, error);
        }
      }

      return troves;
    },
    enabled:
      !!address &&
      !!chainId &&
      !!V3_ADDRESSES_REGISTRY[chainId as keyof typeof V3_ADDRESSES_REGISTRY],
    staleTime: 60000, // 1 minute
    refetchInterval: 60000, // Refetch every minute
    retry: 2,
  });
}
