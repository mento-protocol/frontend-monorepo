import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseUnits,
  parseAbi,
} from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { toast } from "@repo/ui";
import { chainIdToChain } from "@/lib/config/chains";
import { FPMM_ABI, ERC20_ABI, useGetPoolForTokens } from "./use-v3-fpmm-pools";

export const MaxUint256: bigint = BigInt(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
);

interface SwapParams {
  tokenInAddress: string;
  tokenOutAddress: string;
  amountIn: string;
  amountOut: string;
  poolAddress?: string; // Optional - will be discovered if not provided
  slippageTolerance?: number; // in basis points, default 50 (0.5%)
}

export function useV3Swap() {
  const { address } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tokenInAddress,
      tokenOutAddress,
      amountIn,
      amountOut,
      poolAddress: providedPoolAddress,
      slippageTolerance = 50,
    }: SwapParams) => {
      if (!address || !chainId) {
        throw new Error("Wallet not connected");
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

      // Use provided pool address or discover it from factory
      const poolAddress =
        providedPoolAddress ||
        (await getPoolAddressFromFactory(
          tokenInAddress,
          tokenOutAddress,
          chainId,
        ));

      if (!poolAddress) {
        throw new Error(
          `No FPMM pool found for ${tokenInAddress}/${tokenOutAddress}`,
        );
      }

      console.log("Using FPMM pool:", poolAddress);

      // Get token decimals
      const [tokenInDecimals, tokenOutDecimals] = await Promise.all([
        publicClient.readContract({
          address: tokenInAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
        publicClient.readContract({
          address: tokenOutAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);

      // Convert amounts to wei
      const amountInWei = parseUnits(amountIn, tokenInDecimals);
      const amountOutWei = parseUnits(amountOut, tokenOutDecimals);

      // Apply slippage tolerance to minimum amount out
      const slippageMultiplier = BigInt(10000 - slippageTolerance);
      const minAmountOut = (amountOutWei * slippageMultiplier) / BigInt(10000);

      console.log("Swap parameters:", {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInWei.toString(),
        expectedAmountOut: amountOutWei.toString(),
        minAmountOut: minAmountOut.toString(),
        slippageTolerance: slippageTolerance,
        poolAddress,
      });

      // Check allowance and approve token if needed
      const allowance = await publicClient.readContract({
        address: tokenInAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, poolAddress as `0x${string}`],
      });

      console.log("Current allowance:", allowance.toString());

      if (allowance < amountInWei) {
        console.log("Approving token...");
        const approveTx = await walletClient.writeContract({
          address: tokenInAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [poolAddress as `0x${string}`, MaxUint256],
          maxPriorityFeePerGas: BigInt(1000000000),
          gas: BigInt(1000000),
        });

        // Wait for approval transaction
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveTx,
        });

        console.log("Approval transaction completed:", approvalReceipt);
      }

      // Transfer tokens to the pool first (FPMM expects this pattern)
      console.log("Transferring tokens to pool...");
      const transferTx = await walletClient.writeContract({
        address: tokenInAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [poolAddress as `0x${string}`, amountInWei],
        maxPriorityFeePerGas: BigInt(1000000000),
        gas: BigInt(1000000),
      });

      // Wait for transfer transaction
      const transferReceipt = await publicClient.waitForTransactionReceipt({
        hash: transferTx,
      });

      console.log("Transfer transaction completed:", transferReceipt);

      // Determine which token is token0 and token1 in the pool
      const [poolToken0, poolToken1] = await publicClient.readContract({
        address: poolAddress as `0x${string}`,
        abi: FPMM_ABI,
        functionName: "tokens",
      });

      // Calculate swap output amounts based on token positions
      let amount0Out = BigInt(0);
      let amount1Out = BigInt(0);

      if (tokenOutAddress.toLowerCase() === poolToken0.toLowerCase()) {
        amount0Out = minAmountOut;
      } else if (tokenOutAddress.toLowerCase() === poolToken1.toLowerCase()) {
        amount1Out = minAmountOut;
      } else {
        throw new Error("Output token not found in pool");
      }

      console.log("Executing swap...", {
        amount0Out: amount0Out.toString(),
        amount1Out: amount1Out.toString(),
        to: address,
      });

      // Execute the swap
      const swapTx = await walletClient.writeContract({
        address: poolAddress as `0x${string}`,
        abi: FPMM_ABI,
        functionName: "swap",
        args: [amount0Out, amount1Out, address, "0x"],
        maxPriorityFeePerGas: BigInt(1000000000),
        gas: BigInt(1000000),
      });

      // Wait for swap transaction
      const swapReceipt = await publicClient.waitForTransactionReceipt({
        hash: swapTx,
      });

      console.log("Swap completed successfully:", swapReceipt);
      return swapTx;
    },
    onSuccess: (hash) => {
      // Show success toast with transaction details
      const chain = chainIdToChain[chainId || 0];
      const explorerUrl = chain?.explorerUrl;

      const successMessage = explorerUrl
        ? `Swap completed successfully. View on CeloScan: ${explorerUrl}/tx/${hash}`
        : "Swap completed successfully.";

      toast.success(successMessage);

      // Invalidate queries to refresh balances
      queryClient.invalidateQueries({ queryKey: ["accountBalances"] });
      queryClient.invalidateQueries({ queryKey: ["v3FPMMPools"] });
    },
    onError: (error: any) => {
      // Show error toast
      console.error("Swap Error:", error);
      const errorMessage = error.message || "Failed to execute swap";
      toast.error(`Swap Failed: ${errorMessage}`);
      throw error;
    },
  });
}

// FPMM Factory addresses
const FPMM_FACTORY_ADDRESS = {
  [celo.id]: "0x0000000000000000000000000000000000000000", // Not deployed yet
  [celoAlfajores.id]: "0xd8098494a749a3fDAD2D2e7Fa5272D8f274D8FF6",
};

// FPMM Factory ABI
const FPMM_FACTORY_ABI = parseAbi([
  "function deployedFPMMs(address token0, address token1) view returns (address)",
  "function deployedFPMMAddresses() view returns (address[])",
]);

// Helper function to get pool address from factory
async function getPoolAddressFromFactory(
  tokenInAddress: string,
  tokenOutAddress: string,
  chainId: number,
): Promise<string | null> {
  const factoryAddress =
    FPMM_FACTORY_ADDRESS[chainId as keyof typeof FPMM_FACTORY_ADDRESS];

  if (
    !factoryAddress ||
    factoryAddress === "0x0000000000000000000000000000000000000000"
  ) {
    return null;
  }

  const chain = chainId === celo.id ? celo : celoAlfajores;

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });

  try {
    // Try both token order combinations since pools might be deployed with either order
    const pool1 = await publicClient.readContract({
      address: factoryAddress as `0x${string}`,
      abi: FPMM_FACTORY_ABI,
      functionName: "deployedFPMMs",
      args: [tokenInAddress as `0x${string}`, tokenOutAddress as `0x${string}`],
    });

    if (pool1 && pool1 !== "0x0000000000000000000000000000000000000000") {
      return pool1;
    }

    // Try reverse order
    const pool2 = await publicClient.readContract({
      address: factoryAddress as `0x${string}`,
      abi: FPMM_FACTORY_ABI,
      functionName: "deployedFPMMs",
      args: [tokenOutAddress as `0x${string}`, tokenInAddress as `0x${string}`],
    });

    if (pool2 && pool2 !== "0x0000000000000000000000000000000000000000") {
      return pool2;
    }

    return null;
  } catch (error) {
    console.error("Error querying factory for pool:", error);
    return null;
  }
}

// Hook to get swap quote
export function useV3SwapQuote(
  tokenInAddress: string | undefined,
  tokenOutAddress: string | undefined,
  amountIn: string | undefined,
) {
  const chainId = useChainId();
  const poolAddress = useGetPoolForTokens(tokenInAddress, tokenOutAddress);

  return useQuery({
    queryKey: [
      "v3SwapQuote",
      tokenInAddress,
      tokenOutAddress,
      amountIn,
      poolAddress,
      chainId,
    ],
    queryFn: async (): Promise<{
      amountOut: string;
      minimumAmountOut: string;
      priceImpact: string;
    }> => {
      if (!tokenInAddress || !tokenOutAddress || !amountIn || !poolAddress) {
        throw new Error("Missing required parameters");
      }

      const chain = chainId === celo.id ? celo : celoAlfajores;

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // Get token decimals
      const [tokenInDecimals] = await Promise.all([
        publicClient.readContract({
          address: tokenInAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);

      // Convert amount to wei
      const amountInWei = parseUnits(amountIn, tokenInDecimals);

      // Get quote from FPMM pool
      const amountOutWei = await publicClient.readContract({
        address: poolAddress as `0x${string}`,
        abi: FPMM_ABI,
        functionName: "getAmountOut",
        args: [amountInWei, tokenInAddress as `0x${string}`],
      });

      // Get output token decimals for formatting
      const tokenOutDecimals = await publicClient.readContract({
        address: tokenOutAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "decimals",
      });

      const amountOut = formatUnits(amountOutWei, tokenOutDecimals);

      // Calculate minimum amount out with 0.5% slippage
      const minAmountOut = (amountOutWei * BigInt(9950)) / BigInt(10000);
      const minimumAmountOut = formatUnits(minAmountOut, tokenOutDecimals);

      // For FPMM, price impact is minimal since it uses oracle prices
      const priceImpact = "0.1"; // Placeholder - could calculate actual impact

      return {
        amountOut,
        minimumAmountOut,
        priceImpact,
      };
    },
    enabled: !!(
      tokenInAddress &&
      tokenOutAddress &&
      amountIn &&
      poolAddress &&
      chainId
    ),
    staleTime: 10000, // 10 seconds
  });
}

// Utility function to format units (simplified version)
function formatUnits(value: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const quotient = value / divisor;
  const remainder = value % divisor;

  if (remainder === BigInt(0)) {
    return quotient.toString();
  }

  const remainderStr = remainder.toString().padStart(decimals, "0");
  const trimmedRemainder = remainderStr.replace(/0+$/, "");

  if (trimmedRemainder === "") {
    return quotient.toString();
  }

  return `${quotient}.${trimmedRemainder}`;
}
