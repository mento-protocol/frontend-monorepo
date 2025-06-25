import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import { createWalletClient, custom, parseAbi } from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { toast } from "@repo/ui";
import { chainIdToChain } from "@/lib/config/chains";

// Liquidity Strategy ABI for rebalancing
const LIQUIDITY_STRATEGY_ABI = parseAbi([
  "function rebalance(address pool) external",
]);

// Contract addresses for V3
const V3_LIQUIDITY_STRATEGY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0x3dD78d0b0805dcf9E798Bc89c186d5d0a5ffDBda",
};

export function useV3Rebalance() {
  const { address } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (poolAddress: string) => {
      if (!address || !chainId) {
        throw new Error("Wallet not connected");
      }

      const liquidityStrategyAddress =
        V3_LIQUIDITY_STRATEGY[chainId as keyof typeof V3_LIQUIDITY_STRATEGY];
      if (
        !liquidityStrategyAddress ||
        liquidityStrategyAddress ===
          "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error(
          `V3 Liquidity Strategy not deployed on chain ${chainId}`,
        );
      }

      // Check if window.ethereum is available
      if (!window.ethereum) {
        throw new Error("MetaMask not found");
      }

      // Create wallet client
      const walletClient = createWalletClient({
        chain: chainId === celo.id ? celo : celoAlfajores,
        transport: custom(window.ethereum),
        account: address,
      });

      // Execute rebalance transaction
      const hash = await walletClient.writeContract({
        address: liquidityStrategyAddress as `0x${string}`,
        abi: LIQUIDITY_STRATEGY_ABI,
        functionName: "rebalance",
        args: [poolAddress as `0x${string}`],
      });

      return hash;
    },
    onSuccess: (hash) => {
      // Show success toast with transaction details
      const chain = chainIdToChain[chainId || 0];
      const explorerUrl = chain?.explorerUrl;

      const successMessage = explorerUrl
        ? `Pool rebalance transaction submitted successfully. View on CeloScan: ${explorerUrl}/tx/${hash}`
        : "Pool rebalance transaction submitted successfully.";

      toast.success(successMessage);

      // Invalidate and refetch pools data
      queryClient.invalidateQueries({ queryKey: ["v3Pools"] });

      return hash;
    },
    onError: (error: any) => {
      // Show error toast
      const errorMessage =
        error.message || "Failed to submit rebalance transaction";
      toast.error(`Rebalance Failed: ${errorMessage}`);
      throw error;
    },
  });
}
