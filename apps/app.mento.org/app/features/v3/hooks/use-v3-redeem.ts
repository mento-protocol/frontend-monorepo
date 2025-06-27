import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { toast } from "@repo/ui";
import { chainIdToChain } from "@/lib/config/chains";

// V3 Addresses Registry ABI
const ADDRESSES_REGISTRY_ABI = parseAbi([
  "function collateralRegistry() view returns (address)",
  "function boldToken() view returns (address)",
]);

// Collateral Registry ABI for redemption
const COLLATERAL_REGISTRY_ABI = parseAbi([
  "function redeemCollateral(uint256 _boldAmount, uint256 _maxIterations, uint256 _maxFeePercentage) external",
  "function getRedemptionRateForRedeemedAmount(uint256) external view returns (uint256)",
]);

// ERC20 ABI for approvals
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// Contract addresses for V3
const V3_ADDRESSES_REGISTRY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0xd39c90bb4c1e5d63f83a9fe52359897bb1068ed3",
};

export function useV3Redeem() {
  const { address } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount }: { amount: string }) => {
      if (!address || !chainId) {
        throw new Error("Wallet not connected");
      }

      const registryAddress =
        V3_ADDRESSES_REGISTRY[chainId as keyof typeof V3_ADDRESSES_REGISTRY];
      if (
        !registryAddress ||
        registryAddress === "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error(`V3 registry not deployed on chain ${chainId}`);
      }

      // Check if window.ethereum is available
      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }

      const chain = chainId === celo.id ? celo : celoAlfajores;

      // Create public client for reading contract data
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // Create wallet client for transactions
      const walletClient = createWalletClient({
        chain,
        transport: custom(window.ethereum),
        account: address,
      });

      const amountWei = parseUnits(amount, 18);

      const [collateralRegistryAddress, boldTokenAddress] = await Promise.all([
        publicClient.readContract({
          address: registryAddress as `0x${string}`,
          abi: ADDRESSES_REGISTRY_ABI,
          functionName: "collateralRegistry",
        }),
        publicClient.readContract({
          address: registryAddress as `0x${string}`,
          abi: ADDRESSES_REGISTRY_ABI,
          functionName: "boldToken",
        }),
      ]);

      // Check allowance and approve if needed
      const allowance = await publicClient.readContract({
        address: boldTokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, collateralRegistryAddress],
      });

      if (allowance < amountWei) {
        // Approve boldToken (EUR.m) for collateral registry with MaxUint256
        const approveTx = await walletClient.writeContract({
          address: boldTokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [
            collateralRegistryAddress,
            BigInt(
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            ),
          ], // MaxUint256
        });

        console.log("Approval transaction submitted:", approveTx);
      }

      const redemptionRate = await publicClient.readContract({
        address: collateralRegistryAddress,
        abi: COLLATERAL_REGISTRY_ABI,
        functionName: "getRedemptionRateForRedeemedAmount",
        args: [amountWei],
      });

      // Execute redemption
      const maxFeePercentage = parseUnits("1", 18);
      const maxIterations = 20;

      const hash = await walletClient.writeContract({
        address: collateralRegistryAddress,
        abi: COLLATERAL_REGISTRY_ABI,
        functionName: "redeemCollateral",
        args: [amountWei, BigInt(maxIterations), maxFeePercentage],
        maxPriorityFeePerGas: BigInt(1000000000),
      });

      return { hash, redemptionRate };
    },
    onSuccess: (data) => {
      // Show success toast with transaction details
      const chain = chainIdToChain[chainId || 0];
      const explorerUrl = chain?.explorerUrl;

      const successMessage = explorerUrl
        ? `Redemption transaction submitted successfully. View on CeloScan: ${explorerUrl}/tx/${data.hash}`
        : "Redemption transaction submitted successfully.";

      toast.success(successMessage);

      // Invalidate and refetch relevant data
      queryClient.invalidateQueries({ queryKey: ["v3Troves"] });
      queryClient.invalidateQueries({ queryKey: ["accountBalances"] });

      return data.hash;
    },
    onError: (error: any) => {
      // Show error toast
      const errorMessage =
        error.message || "Failed to submit redemption transaction";
      toast.error(`Redemption Failed: ${errorMessage}`);
      throw error;
    },
  });
}

export function useV3RedemptionRate(amount: string) {
  const { address } = useAccount();
  const chainId = useChainId();

  return useQuery({
    queryKey: ["v3RedemptionRate", chainId, amount],
    queryFn: async () => {
      if (!address || !chainId || !amount || parseFloat(amount) <= 0) {
        return null;
      }

      const registryAddress =
        V3_ADDRESSES_REGISTRY[chainId as keyof typeof V3_ADDRESSES_REGISTRY];
      if (
        !registryAddress ||
        registryAddress === "0x0000000000000000000000000000000000000000"
      ) {
        return null;
      }

      const chain = chainId === celo.id ? celo : celoAlfajores;

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      const amountWei = parseUnits(amount, 18);

      const collateralRegistryAddress = await publicClient.readContract({
        address: registryAddress as `0x${string}`,
        abi: ADDRESSES_REGISTRY_ABI,
        functionName: "collateralRegistry",
      });

      const redemptionRate = await publicClient.readContract({
        address: collateralRegistryAddress,
        abi: COLLATERAL_REGISTRY_ABI,
        functionName: "getRedemptionRateForRedeemedAmount",
        args: [amountWei],
      });

      return redemptionRate;
    },
    enabled: Boolean(address && chainId && amount && parseFloat(amount) > 0),
    refetchInterval: 10000, // Refetch every 10 seconds
    staleTime: 5000, // Consider data stale after 5 seconds
  });
}
