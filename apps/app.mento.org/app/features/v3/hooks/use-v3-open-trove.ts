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

// Borrower Operations ABI - exact same as working basic UI
const BORROWER_OPERATIONS_ABI = parseAbi([
  "function openTrove(address _owner, uint256 _ownerIndex, uint256 _collAmount, uint256 _boldAmount, uint256 _upperHint, uint256 _lowerHint, uint256 _annualInterestRate, uint256 _maxUpfrontFee, address _addManager, address _removeManager, address _receiver) returns (uint256)",
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

      // Convert amounts to wei - exactly like basic UI
      const collAmount = parseUnits(collateralAmount, 18);
      const boldAmount = parseUnits(borrowAmount, 18);
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

      console.log("collTokenAddress", collTokenAddress);
      console.log("borrowerOperationsAddress", borrowerOperationsAddress);

      // Check allowance and approve collateral token if needed - exactly like basic UI
      const allowance = await publicClient.readContract({
        address: collTokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, borrowerOperationsAddress],
      });

      console.log({ allowance });

      if (allowance < collAmount) {
        const approveTx = await walletClient.writeContract({
          address: collTokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [borrowerOperationsAddress, MaxUint256],
        });

        // Wait for approval transaction
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: approveTx,
        });

        console.log("Approval transaction completed:", receipt);
      }

      const ownerIndex = Math.floor(Date.now() / 1000);

      console.log("Opening trove with parameters:", {
        owner: address,
        ownerIndex,
        collAmount: collAmount.toString(),
        boldAmount: boldAmount.toString(),
        upperHint: "0",
        lowerHint: "0",
        annualInterestRate: interestRateWei.toString(),
        maxUpfrontFee: MaxUint256.toString(),
        addManager: "0x0000000000000000000000000000000000000000",
        removeManager: "0x0000000000000000000000000000000000000000",
        receiver: "0x0000000000000000000000000000000000000000",
      });

      const tx = await walletClient.writeContract({
        address: borrowerOperationsAddress,
        abi: BORROWER_OPERATIONS_ABI,
        functionName: "openTrove",
        args: [
          address, // owner
          BigInt(ownerIndex), // ownerIndex
          collAmount, // collAmount
          boldAmount, // boldAmount
          BigInt(0), // upperHint
          BigInt(0), // lowerHint
          interestRateWei, // annualInterestRate
          MaxUint256, // maxUpfrontFee
          "0x0000000000000000000000000000000000000000" as `0x${string}`, // addManager
          "0x0000000000000000000000000000000000000000" as `0x${string}`, // removeManager
          "0x0000000000000000000000000000000000000000" as `0x${string}`, // receiver
        ],
        maxPriorityFeePerGas: BigInt(1000000000),
        gas: BigInt(1000000),
      });

      // Wait for transaction
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      console.log("Trove opened successfully:", receipt);
      return tx;
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
      console.error("Open Trove Error:", error);
      const errorMessage = error.message || "Failed to open trove";
      toast.error(`Open Trove Failed: ${errorMessage}`);
      throw error;
    },
  });
}
