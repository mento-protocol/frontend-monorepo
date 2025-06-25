import { useMutation, useQueryClient } from "@tanstack/react-query";
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

export const MaxUint256: bigint = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
);

// V3 Addresses Registry ABI
const ADDRESSES_REGISTRY_ABI = parseAbi([
  "function borrowerOperations() view returns (address)",
  "function collToken() view returns (address)",
]);

// Borrower Operations ABI
const BORROWER_OPERATIONS_ABI = parseAbi([
  "function openTrove(address _owner, uint256 _ownerIndex, uint256 _collAmount, uint256 _boldAmount, uint256 _upperHint, uint256 _lowerHint, uint256 _annualInterestRate, uint256 _maxUpfrontFee, address _addManager, address _removeManager, address _receiver) external",
]);

// ERC20 ABI for approvals
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// Contract addresses for V3
const V3_ADDRESSES_REGISTRY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0xf9bc8b3a0fb0ed51e2c4339849ca96b0ba7a69a4",
};

interface OpenTroveParams {
  collateralAmount: string;
  borrowAmount: string;
  interestRate: string;
}

export function useV3OpenTrove() {
  const { address } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      collateralAmount,
      borrowAmount,
      interestRate,
    }: OpenTroveParams) => {
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

      // Convert amounts to wei
      const collAmountWei = parseUnits(collateralAmount, 18);
      const borrowAmountWei = parseUnits(borrowAmount, 18);
      const interestRateWei = parseUnits(interestRate, 16); // Convert to basis points

      // Get contract addresses from registry
      const [borrowerOperationsAddress, collTokenAddress] = await Promise.all([
        publicClient.readContract({
          address: registryAddress as `0x${string}`,
          abi: ADDRESSES_REGISTRY_ABI,
          functionName: "borrowerOperations",
        }),
        publicClient.readContract({
          address: registryAddress as `0x${string}`,
          abi: ADDRESSES_REGISTRY_ABI,
          functionName: "collToken",
        }),
      ]);

      // Check allowance and approve collateral token if needed
      const allowance = await publicClient.readContract({
        address: collTokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, borrowerOperationsAddress],
      });

      if (allowance < collAmountWei) {
        // Approve collateral token for borrower operations with MaxUint256
        const approveTx = await walletClient.writeContract({
          address: collTokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [borrowerOperationsAddress, MaxUint256],
        });

        console.log("Approval transaction submitted:", approveTx);
      }

      // Open trove with parameters matching basic UI
      const ownerIndex = Math.floor(Date.now() / 1000); // Unique owner index
      const upperHint = BigInt(0); // Hints for position in sorted list (0 = no hint)
      const lowerHint = BigInt(0);
      const maxUpfrontFee = MaxUint256; // Maximum upfront fee willing to pay
      const addManager = "0x0000000000000000000000000000000000000000"; // No add manager
      const removeManager = "0x0000000000000000000000000000000000000000"; // No remove manager
      const receiver = "0x0000000000000000000000000000000000000000"; // No receiver (user gets tokens)

      // Estimate gas for the transaction first
      const estimatedGas = await publicClient.estimateContractGas({
        address: borrowerOperationsAddress,
        abi: BORROWER_OPERATIONS_ABI,
        functionName: "openTrove",
        args: [
          address, // owner
          BigInt(ownerIndex), // ownerIndex
          collAmountWei, // collAmount
          borrowAmountWei, // boldAmount
          upperHint, // upperHint
          lowerHint, // lowerHint
          interestRateWei, // annualInterestRate
          maxUpfrontFee, // maxUpfrontFee
          addManager, // addManager
          removeManager, // removeManager
          receiver, // receiver
        ],
        account: address,
      });

      // Add 20% buffer to gas estimate
      const gasLimit = (estimatedGas * 120n) / 100n;

      const hash = await walletClient.writeContract({
        address: borrowerOperationsAddress,
        abi: BORROWER_OPERATIONS_ABI,
        functionName: "openTrove",
        args: [
          address, // owner
          BigInt(ownerIndex), // ownerIndex
          collAmountWei, // collAmount
          borrowAmountWei, // boldAmount
          upperHint, // upperHint
          lowerHint, // lowerHint
          interestRateWei, // annualInterestRate
          maxUpfrontFee, // maxUpfrontFee
          addManager, // addManager
          removeManager, // removeManager
          receiver, // receiver
        ],
        gas: gasLimit,
      });

      return hash;
    },
    onSuccess: (hash) => {
      // Show success toast with transaction details
      const chain = chainIdToChain[chainId || 0];
      const explorerUrl = chain?.explorerUrl;

      const successMessage = explorerUrl
        ? `Trove opened successfully. View on CeloScan: ${explorerUrl}/tx/${hash}`
        : "Trove opened successfully.";

      toast.success(successMessage);

      // Invalidate and refetch relevant data
      queryClient.invalidateQueries({ queryKey: ["v3Troves"] });
      queryClient.invalidateQueries({ queryKey: ["accountBalances"] });

      return hash;
    },
    onError: (error: any) => {
      // Show error toast
      const errorMessage = error.message || "Failed to open trove";
      toast.error(`Open Trove Failed: ${errorMessage}`);
      throw error;
    },
  });
}
