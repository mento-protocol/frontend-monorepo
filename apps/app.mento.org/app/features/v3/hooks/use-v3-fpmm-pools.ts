import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { createPublicClient, http, parseAbi } from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { Tokens, TokenId } from "@/lib/config/tokens";

// FPMM Factory ABI
const FPMM_FACTORY_ABI = parseAbi([
  "function deployedFPMMAddresses() view returns (address[])",
]);

// FPMM Pool ABI
const FPMM_ABI = parseAbi([
  "function tokens() view returns (address, address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256 amountOut)",
  "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external",
]);

// ERC20 ABI for token info
const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// FPMM Factory addresses
const FPMM_FACTORY_ADDRESS = {
  [celo.id]: "0x0000000000000000000000000000000000000000", // Not deployed yet
  [celoAlfajores.id]: "0xd8098494a749a3fDAD2D2e7Fa5272D8f274D8FF6",
};

// Helper function to enhance token with config data for icon support
function enhanceTokenWithConfig(tokenInfo: {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}): TokenInfo {
  // Try to find matching token in config by symbol
  const configToken = Object.values(Tokens).find(
    (token) => token.symbol === tokenInfo.symbol,
  );

  if (configToken) {
    return {
      ...tokenInfo,
      id: configToken.id,
      color: configToken.color,
    };
  }

  // Special mappings for common tokens that might have different symbols
  const symbolMappings: Record<string, { id: string; color: string }> = {
    BridgedUSDC: { id: "USDC", color: "#2775CA" },
    "USD.m": { id: "USDm", color: "#000000" },
    "EUR.m": { id: "EURm", color: "#4F46E5" },
    USDC: { id: "USDC", color: "#2775CA" },
  };

  const mapping = symbolMappings[tokenInfo.symbol];
  if (mapping) {
    return {
      ...tokenInfo,
      id: mapping.id,
      color: mapping.color,
    };
  }

  // Fallback: create token-like object with default color
  return {
    ...tokenInfo,
    id: tokenInfo.symbol, // Use symbol as id if no mapping found
    color: "#6B7280", // Default gray color
  };
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
  id: string; // Make id required
  color?: string;
}

export interface FPMMPool {
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
}

export interface TokenPairMapping {
  [tokenAddress: string]: {
    token: TokenInfo;
    availableOutputs: Array<{
      token: TokenInfo;
      poolAddress: string;
    }>;
  };
}

export function useV3FPMMPools() {
  const chainId = useChainId();

  return useQuery({
    queryKey: ["v3FPMMPools", chainId],
    queryFn: async (): Promise<{
      pools: FPMMPool[];
      tokenMapping: TokenPairMapping;
      allTokens: TokenInfo[];
    }> => {
      const factoryAddress =
        FPMM_FACTORY_ADDRESS[chainId as keyof typeof FPMM_FACTORY_ADDRESS];

      if (
        !factoryAddress ||
        factoryAddress === "0x0000000000000000000000000000000000000000"
      ) {
        throw new Error(`FPMM Factory not deployed on chain ${chainId}`);
      }

      const chain = chainId === celo.id ? celo : celoAlfajores;

      // Create public client for reading contract data
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // Get all deployed FPMM pool addresses
      const poolAddresses = await publicClient.readContract({
        address: factoryAddress as `0x${string}`,
        abi: FPMM_FACTORY_ABI,
        functionName: "deployedFPMMAddresses",
      });

      console.log("Found FPMM pools:", poolAddresses);

      // Fetch token info for each pool
      const pools: FPMMPool[] = [];
      const tokenInfoCache = new Map<string, TokenInfo>();

      for (const poolAddress of poolAddresses) {
        try {
          // Get token addresses from pool
          const [token0Address, token1Address] =
            await publicClient.readContract({
              address: poolAddress,
              abi: FPMM_ABI,
              functionName: "tokens",
            });

          // Helper function to get token info with caching
          const getTokenInfo = async (
            tokenAddress: string,
          ): Promise<TokenInfo> => {
            if (tokenInfoCache.has(tokenAddress)) {
              return tokenInfoCache.get(tokenAddress)!;
            }

            const [symbol, decimals, name] = await Promise.all([
              publicClient.readContract({
                address: tokenAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "symbol",
              }),
              publicClient.readContract({
                address: tokenAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "decimals",
              }),
              publicClient.readContract({
                address: tokenAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: "name",
              }),
            ]);

            const basicTokenInfo = {
              address: tokenAddress,
              symbol: symbol as string,
              decimals: decimals as number,
              name: name as string,
            };

            const enhancedTokenInfo = enhanceTokenWithConfig(basicTokenInfo);
            tokenInfoCache.set(tokenAddress, enhancedTokenInfo);
            return enhancedTokenInfo;
          };

          // Get token info for both tokens
          const [token0Info, token1Info] = await Promise.all([
            getTokenInfo(token0Address),
            getTokenInfo(token1Address),
          ]);

          pools.push({
            address: poolAddress,
            token0: token0Info,
            token1: token1Info,
          });

          console.log(
            `Pool ${poolAddress}: ${token0Info.symbol}/${token1Info.symbol}`,
          );
        } catch (error) {
          console.error(`Error fetching info for pool ${poolAddress}:`, error);
        }
      }

      // Build token mapping for dynamic selection
      const tokenMapping: TokenPairMapping = {};
      const allTokensMap = new Map<string, TokenInfo>();

      for (const pool of pools) {
        // Add token0 -> token1 mapping
        if (!tokenMapping[pool.token0.address]) {
          tokenMapping[pool.token0.address] = {
            token: pool.token0,
            availableOutputs: [],
          };
        }
        tokenMapping[pool.token0.address].availableOutputs.push({
          token: pool.token1,
          poolAddress: pool.address,
        });

        // Add token1 -> token0 mapping
        if (!tokenMapping[pool.token1.address]) {
          tokenMapping[pool.token1.address] = {
            token: pool.token1,
            availableOutputs: [],
          };
        }
        tokenMapping[pool.token1.address].availableOutputs.push({
          token: pool.token0,
          poolAddress: pool.address,
        });

        // Collect all unique tokens
        allTokensMap.set(pool.token0.address, pool.token0);
        allTokensMap.set(pool.token1.address, pool.token1);
      }

      const allTokens = Array.from(allTokensMap.values());

      console.log("Token mapping:", tokenMapping);
      console.log("All available tokens:", allTokens);

      return {
        pools,
        tokenMapping,
        allTokens,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!chainId,
  });
}

// Helper hook to get pool address for a specific token pair
export function useGetPoolForTokens(
  tokenInAddress: string | undefined,
  tokenOutAddress: string | undefined,
) {
  const { data } = useV3FPMMPools();

  if (!data || !tokenInAddress || !tokenOutAddress) {
    return undefined;
  }

  const inputTokenMapping = data.tokenMapping[tokenInAddress];
  if (!inputTokenMapping) {
    return undefined;
  }

  const outputMapping = inputTokenMapping.availableOutputs.find(
    (output) => output.token.address === tokenOutAddress,
  );

  return outputMapping?.poolAddress;
}

// Export the ABIs for use in other hooks
export { FPMM_ABI, ERC20_ABI };
