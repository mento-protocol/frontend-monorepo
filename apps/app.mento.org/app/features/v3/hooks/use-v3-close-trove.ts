import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseAbi,
} from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { toast } from "@repo/ui";
import { chainIdToChain } from "@/lib/config/chains";

export const MaxUint256: bigint = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
);

// V3 Addresses Registry ABI
const ADDRESSES_REGISTRY_ABI = parseAbi([
  "function borrowerOperations() view returns (address)",
  "function boldToken() view returns (address)",
  "function troveManager() view returns (address)",
]);

// Borrower Operations ABI
const BORROWER_OPERATIONS_ABI = parseAbi([
  "function closeTrove(uint256 _troveId) external",
]);

// Trove Manager ABI
const TROVE_MANAGER_ABI = parseAbi([
  "function Troves(uint256 troveId) view returns (uint256 debt, uint256 coll, uint256 stake, uint8 status, uint128 arrayIndex, uint256 annualInterestRate, uint256 lastInterestRateAdjTime, address borrower, uint256 lastDebtUpdateTime, uint256 lastCollUpdateTime)",
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

export function useV3CloseTrove() {
  const { address } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (troveId: string) => {
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

      // Get contract addresses from registry
      const [borrowerOperationsAddress, boldTokenAddress, troveManagerAddress] =
        await Promise.all([
          publicClient.readContract({
            address: registryAddress as `0x${string}`,
            abi: ADDRESSES_REGISTRY_ABI,
            functionName: "borrowerOperations",
          }),
          publicClient.readContract({
            address: registryAddress as `0x${string}`,
            abi: ADDRESSES_REGISTRY_ABI,
            functionName: "boldToken",
          }),
          publicClient.readContract({
            address: registryAddress as `0x${string}`,
            abi: ADDRESSES_REGISTRY_ABI,
            functionName: "troveManager",
          }),
        ]);

      // Get trove data to know how much debt to repay
      const troveData = await publicClient.readContract({
        address: troveManagerAddress,
        abi: TROVE_MANAGER_ABI,
        functionName: "Troves",
        args: [BigInt(troveId)],
      });

      const debtAmount = troveData[0]; // debt is the first element in the tuple

      // Check allowance and approve bold token if needed
      const allowance = await publicClient.readContract({
        address: boldTokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, borrowerOperationsAddress],
      });

      if (allowance < debtAmount) {
        // Approve bold token for borrower operations with MaxUint256
        const approveTx = await walletClient.writeContract({
          address: boldTokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [borrowerOperationsAddress, MaxUint256],
        });

        console.log("Approval transaction submitted:", approveTx);
      }

      // Close trove
      const hash = await walletClient.writeContract({
        address: borrowerOperationsAddress,
        abi: BORROWER_OPERATIONS_ABI,
        functionName: "closeTrove",
        args: [BigInt(troveId)],
      });

      return hash;
    },
    onSuccess: (hash) => {
      // Show success toast with transaction details
      const chain = chainIdToChain[chainId || 0];
      const explorerUrl = chain?.explorerUrl;

      const successMessage = explorerUrl
        ? `Trove closed successfully. View on CeloScan: ${explorerUrl}/tx/${hash}`
        : "Trove closed successfully.";

      toast.success(successMessage);

      // Invalidate and refetch relevant data
      queryClient.invalidateQueries({ queryKey: ["v3Troves"] });
      queryClient.invalidateQueries({ queryKey: ["accountBalances"] });

      return hash;
    },
    onError: (error: any) => {
      // Show error toast
      const errorMessage = error.message || "Failed to close trove";
      toast.error(`Close Trove Failed: ${errorMessage}`);
      throw error;
    },
  });
}
