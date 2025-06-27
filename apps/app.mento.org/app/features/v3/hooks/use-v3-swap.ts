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

// FPMM ABI for swap functionality
const FPMM_ABI = parseAbi([
  "function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256 amountOut)",
  "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)",
]);

// ERC20 ABI for token transfers
const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// V3 Addresses Registry ABI
const ADDRESSES_REGISTRY_ABI = parseAbi([
  "function collToken() view returns (address)",
  "function boldToken() view returns (address)",
]);

// Contract addresses for V3
const V3_ADDRESSES_REGISTRY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0xd39c90bb4c1e5d63f83a9fe52359897bb1068ed3",
};

const V3_FPMM_POOL = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0x7DBA083Db8303416D858cbF6282698F90f375Aec",
};

const FPMM_TOKENS = {
  [celoAlfajores.id]: {
    "USD.m": "0x9E2d4412d0f434cC85500b79447d9323a7416f09",
    "EUR.m": "0x46504ef8f2Fd6858e8A94C662350EB62ce1b627F",
    MockUSDC: "0x87D61dA3d668797786D73BC674F053f87111570d",
  },
};

interface SwapParams {
  fromToken: "USD.m" | "EUR.m";
  toToken: "USD.m" | "EUR.m";
  amount: string;
}

export function useV3Swap() {
  const { address } = useAccount();
  const chainId = useChainId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ fromToken, toToken, amount }: SwapParams) => {
      if (!address || !chainId) {
        throw new Error("Wallet not connected");
      }

      if (fromToken === toToken) {
        throw new Error("Cannot swap the same token");
      }

      const registryAddress =
        V3_ADDRESSES_REGISTRY[chainId as keyof typeof V3_ADDRESSES_REGISTRY];
      const fpmmAddress = V3_FPMM_POOL[chainId as keyof typeof V3_FPMM_POOL];

      if (
        !registryAddress ||
        registryAddress === "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error(`V3 registry not deployed on chain ${chainId}`);
      }

      if (
        !fpmmAddress ||
        fpmmAddress === "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error(`V3 FPMM pool not deployed on chain ${chainId}`);
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

      // Get the token addresses that are actually in the FPMM pool
      const fpmmTokens = FPMM_TOKENS[chainId as keyof typeof FPMM_TOKENS];
      if (!fpmmTokens) {
        throw new Error(`FPMM tokens not configured for chain ${chainId}`);
      }

      // Get FPMM pool token addresses to determine token order
      const [token0Address, token1Address] = await Promise.all([
        publicClient.readContract({
          address: fpmmAddress as `0x${string}`,
          abi: FPMM_ABI,
          functionName: "token0",
        }),
        publicClient.readContract({
          address: fpmmAddress as `0x${string}`,
          abi: FPMM_ABI,
          functionName: "token1",
        }),
      ]);

      console.log("FPMM Pool tokens:", { token0Address, token1Address });
      console.log("FPMM Configured tokens:", fpmmTokens);

      // Use the configured token addresses
      const fromTokenAddress = fpmmTokens[fromToken];

      if (
        !fromTokenAddress ||
        fromTokenAddress === "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error(`${fromToken} token not configured for FPMM`);
      }

      // Convert amount to wei (assuming 18 decimals for both tokens)
      const amountIn = parseUnits(amount, 18);

      // Check user balance
      const balance = await publicClient.readContract({
        address: fromTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });

      if (balance < amountIn) {
        throw new Error(`Insufficient ${fromToken} balance`);
      }

      // Get expected output amount
      const amountOut = await publicClient.readContract({
        address: fpmmAddress as `0x${string}`,
        abi: FPMM_ABI,
        functionName: "getAmountOut",
        args: [amountIn, fromTokenAddress as `0x${string}`],
      });

      if (amountOut === BigInt(0)) {
        throw new Error("No output amount available for this swap");
      }

      // Step 1: Transfer tokens to FPMM pool
      const transferTx = await walletClient.writeContract({
        address: fromTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [fpmmAddress as `0x${string}`, amountIn],
        maxPriorityFeePerGas: BigInt(1000000000),
      });

      console.log("Token transfer transaction:", transferTx);

      // Step 2: Execute swap
      // Determine amount0Out and amount1Out based on token order
      let amount0Out = BigInt(0);
      let amount1Out = BigInt(0);

      if (fromTokenAddress.toLowerCase() === token0Address.toLowerCase()) {
        // Swapping token0 for token1
        amount1Out = amountOut;
      } else {
        // Swapping token1 for token0
        amount0Out = amountOut;
      }

      const swapTx = await walletClient.writeContract({
        address: fpmmAddress as `0x${string}`,
        abi: FPMM_ABI,
        functionName: "swap",
        args: [amount0Out, amount1Out, address, "0x"],
        maxPriorityFeePerGas: BigInt(1000000000),
      });

      return {
        transferTx,
        swapTx,
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
        fromToken,
        toToken,
      };
    },
    onSuccess: (result) => {
      // Show success toast with transaction details
      const chain = chainIdToChain[chainId || 0];
      const explorerUrl = chain?.explorerUrl;

      const successMessage = explorerUrl
        ? `Swap completed successfully! Swapped ${result.fromToken} for ${result.toToken}. View on CeloScan: ${explorerUrl}/tx/${result.swapTx}`
        : `Swap completed successfully! Swapped ${result.fromToken} for ${result.toToken}.`;

      toast.success(successMessage);

      // Invalidate and refetch relevant data
      queryClient.invalidateQueries({ queryKey: ["accountBalances"] });
      queryClient.invalidateQueries({ queryKey: ["v3Pools"] });

      return result;
    },
    onError: (error: any) => {
      // Show error toast
      const errorMessage = error.message || "Failed to swap tokens";
      toast.error(`Swap Failed: ${errorMessage}`);
      throw error;
    },
  });
}

// Hook to get swap quote without executing the swap
export function useV3SwapQuote() {
  const { address } = useAccount();
  const chainId = useChainId();

  const getQuote = async ({
    fromToken,
    toToken,
    amount,
  }: {
    fromToken: "USD.m" | "EUR.m";
    toToken: "USD.m" | "EUR.m";
    amount: string;
  }) => {
    if (!address || !chainId || !amount || parseFloat(amount) <= 0) {
      return null;
    }

    if (fromToken === toToken) {
      return null;
    }

    const registryAddress =
      V3_ADDRESSES_REGISTRY[chainId as keyof typeof V3_ADDRESSES_REGISTRY];
    const fpmmAddress = V3_FPMM_POOL[chainId as keyof typeof V3_FPMM_POOL];

    if (
      !registryAddress ||
      registryAddress === "0x0000000000000000000000000000000000000000" ||
      !fpmmAddress ||
      fpmmAddress === "0x0000000000000000000000000000000000000000"
    ) {
      return null;
    }

    try {
      const chain = chainId === celo.id ? celo : celoAlfajores;

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // Get the token addresses that are actually in the FPMM pool
      const fpmmTokens = FPMM_TOKENS[chainId as keyof typeof FPMM_TOKENS];
      if (!fpmmTokens) {
        console.error(`FPMM tokens not configured for chain ${chainId}`);
        return null;
      }

      // Use the configured token addresses
      const fromTokenAddress = fpmmTokens[fromToken];

      if (
        !fromTokenAddress ||
        fromTokenAddress === "0x0000000000000000000000000000000000000000"
      ) {
        console.error(`${fromToken} token not configured for FPMM`);
        return null;
      }

      const amountIn = parseUnits(amount, 18);

      const amountOut = await publicClient.readContract({
        address: fpmmAddress as `0x${string}`,
        abi: FPMM_ABI,
        functionName: "getAmountOut",
        args: [amountIn, fromTokenAddress as `0x${string}`],
      });

      return {
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
        amountOutFormatted: parseFloat(
          (Number(amountOut) / 1e18).toFixed(6),
        ).toString(),
      };
    } catch (error) {
      console.error("Error getting swap quote:", error);
      return null;
    }
  };

  return { getQuote };
}
