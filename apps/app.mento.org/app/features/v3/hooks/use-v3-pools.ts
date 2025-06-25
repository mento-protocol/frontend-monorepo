import { useQuery } from "@tanstack/react-query";
import { useChainId } from "wagmi";
import { createPublicClient, http, formatUnits, parseAbi } from "viem";
import { celo, celoAlfajores } from "viem/chains";

// Liquidity Strategy ABI
const LIQUIDITY_STRATEGY_ABI = parseAbi([
  "function getPools() view returns (address[])",
  "function fpmmPoolConfigs(address) view returns (uint256 lastRebalance, uint256 rebalanceCooldown, uint256 rebalanceIncentive)",
]);

// FPMM Pool ABI
const FPMM_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function metadata() view returns (uint256 decimal0, uint256 decimal1, uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast, uint256 oraclePrice)",
  "function getPrices() view returns (uint256 oraclePrice, uint256 poolPrice, uint256 timestamp, uint256 blockNumber)",
  "function rebalanceThresholdAbove() view returns (uint256)",
  "function rebalanceThresholdBelow() view returns (uint256)",
]);

// ERC20 ABI for token symbols
const ERC20_ABI = parseAbi(["function symbol() view returns (string)"]);

// Contract addresses for V3
const V3_LIQUIDITY_STRATEGY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0x3dD78d0b0805dcf9E798Bc89c186d5d0a5ffDBda",
};

export interface V3Pool {
  address: string;
  token0Address: string;
  token1Address: string;
  token0Symbol: string;
  token1Symbol: string;
  reserve0: string;
  reserve1: string;
  oraclePrice: string;
  poolPrice: string;
  deviation: number;
  lastRebalance: string;
  rebalanceCooldown: string;
  rebalanceIncentive: string;
  thresholdAbove: string;
  thresholdBelow: string;
  canRebalance: boolean;
  reserves: {
    token1: { amount: number; value: number; percentage: number };
    token2: { amount: number; value: number; percentage: number };
    total: number;
  };
  details: {
    currentPoolPrice: string;
    oracleTargetPrice: string;
    thresholds: string;
  };
}

export function useV3Pools() {
  const chainId = useChainId();

  return useQuery({
    queryKey: ["v3Pools", chainId],
    queryFn: async (): Promise<V3Pool[]> => {
      if (!chainId) {
        return [];
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

      // Create public client for the current chain
      const publicClient = createPublicClient({
        chain: chainId === celo.id ? celo : celoAlfajores,
        transport: http(),
      });

      // Get all registered pools
      const poolAddresses = await publicClient.readContract({
        address: liquidityStrategyAddress as `0x${string}`,
        abi: LIQUIDITY_STRATEGY_ABI,
        functionName: "getPools",
      });

      // Get pool from the fpmm factory

      if (poolAddresses.length === 0) {
        return [];
      }

      const pools: V3Pool[] = [];
      const now = Math.floor(Date.now() / 1000);

      // Fetch data for each pool
      for (const poolAddress of poolAddresses) {
        try {
          // Get pool configuration from liquidity strategy
          const poolConfig = await publicClient.readContract({
            address: liquidityStrategyAddress as `0x${string}`,
            abi: LIQUIDITY_STRATEGY_ABI,
            functionName: "fpmmPoolConfigs",
            args: [poolAddress],
          });

          const [lastRebalance, rebalanceCooldown, rebalanceIncentive] =
            poolConfig;

          // Get pool data
          const [
            metadata,
            prices,
            thresholdAbove,
            thresholdBelow,
            token0Address,
            token1Address,
          ] = await Promise.all([
            publicClient.readContract({
              address: poolAddress,
              abi: FPMM_ABI,
              functionName: "metadata",
            }),
            publicClient.readContract({
              address: poolAddress,
              abi: FPMM_ABI,
              functionName: "getPrices",
            }),
            publicClient.readContract({
              address: poolAddress,
              abi: FPMM_ABI,
              functionName: "rebalanceThresholdAbove",
            }),
            publicClient.readContract({
              address: poolAddress,
              abi: FPMM_ABI,
              functionName: "rebalanceThresholdBelow",
            }),
            publicClient.readContract({
              address: poolAddress,
              abi: FPMM_ABI,
              functionName: "token0",
            }),
            publicClient.readContract({
              address: poolAddress,
              abi: FPMM_ABI,
              functionName: "token1",
            }),
          ]);

          // Get token symbols
          let token0Symbol = "Unknown";
          let token1Symbol = "Unknown";

          try {
            token0Symbol = await publicClient.readContract({
              address: token0Address,
              abi: ERC20_ABI,
              functionName: "symbol",
            });
          } catch (error) {
            console.error(
              `Error getting symbol for token 0 (${token0Address}):`,
              error,
            );
            token0Symbol = token0Address.substring(0, 6) + "...";
          }

          try {
            token1Symbol = await publicClient.readContract({
              address: token1Address,
              abi: ERC20_ABI,
              functionName: "symbol",
            });
          } catch (error) {
            console.error(
              `Error getting symbol for token 1 (${token1Address}):`,
              error,
            );
            token1Symbol = token1Address.substring(0, 6) + "...";
          }

          // Parse metadata and prices
          const [, , reserve0, reserve1] = metadata;
          const [oraclePrice, poolPrice] = prices;

          // Calculate deviation first
          const oraclePriceNum = parseFloat(formatUnits(oraclePrice, 18));
          const poolPriceNum = parseFloat(formatUnits(poolPrice, 18));
          const deviation =
            oraclePriceNum > 0
              ? ((poolPriceNum - oraclePriceNum) / oraclePriceNum) * 100
              : 0;

          // Calculate if rebalance is possible (cooldown check)
          const cooldownEnds =
            Number(lastRebalance) + Number(rebalanceCooldown);
          const cooldownPassed = now > cooldownEnds;

          // Parse thresholds to check deviation
          const thresholdAboveNum = parseFloat(formatUnits(thresholdAbove, 2));
          const thresholdBelowNum = parseFloat(formatUnits(thresholdBelow, 2));

          // Check if deviation is outside thresholds
          const deviationOutsideThresholds =
            deviation > thresholdAboveNum || deviation < -thresholdBelowNum;

          // Can rebalance if cooldown passed AND deviation is outside thresholds
          const canRebalance = cooldownPassed && deviationOutsideThresholds;

          // Format reserve amounts (assuming different decimals for different tokens)
          const reserve0Formatted = parseFloat(formatUnits(reserve0, 18));
          const reserve1Formatted = parseFloat(formatUnits(reserve1, 6)); // USDC-like token

          // Calculate reserve values and percentages
          const reserve0Value = reserve0Formatted * oraclePriceNum;
          const reserve1Value = reserve1Formatted; // Assuming USD value
          const totalValue = reserve0Value + reserve1Value; // TODO: 😜
          const reserve0Percentage =
            totalValue > 0 ? (reserve0Value / totalValue) * 100 : 50;
          const reserve1Percentage =
            totalValue > 0 ? (reserve1Value / totalValue) * 100 : 50;

          pools.push({
            address: poolAddress,
            token0Address,
            token1Address,
            token0Symbol,
            token1Symbol,
            reserve0: formatUnits(reserve0, 18),
            reserve1: formatUnits(reserve1, 6),
            oraclePrice: formatUnits(oraclePrice, 18),
            poolPrice: formatUnits(poolPrice, 18),
            deviation,
            lastRebalance: new Date(
              Number(lastRebalance) * 1000,
            ).toLocaleString(),
            rebalanceCooldown: new Date(cooldownEnds * 1000).toLocaleString(),
            rebalanceIncentive: formatUnits(rebalanceIncentive, 16), // Basis points to percentage
            thresholdAbove: formatUnits(thresholdAbove, 2), // Convert from basis points (500 = 5.00%)
            thresholdBelow: formatUnits(thresholdBelow, 2), // Convert from basis points (500 = 5.00%)
            canRebalance,
            reserves: {
              token1: {
                amount: reserve0Formatted,
                value: reserve0Value,
                percentage: reserve0Percentage,
              },
              token2: {
                amount: reserve1Formatted,
                value: reserve1Value,
                percentage: reserve1Percentage,
              },
              total: totalValue,
            },
            details: {
              currentPoolPrice: `${poolPriceNum.toFixed(4)} ${token1Symbol} per ${token0Symbol}`,
              oracleTargetPrice: `${oraclePriceNum.toFixed(4)} ${token1Symbol} per ${token0Symbol}`,
              thresholds: `+${formatUnits(thresholdAbove, 2)}% / -${formatUnits(thresholdBelow, 2)}%`,
            },
          });
        } catch (error) {
          console.error(`Error loading pool ${poolAddress}:`, error);
        }
      }

      return pools;
    },
    enabled:
      !!chainId &&
      !!V3_LIQUIDITY_STRATEGY[chainId as keyof typeof V3_LIQUIDITY_STRATEGY],
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Refetch every 30 seconds
    retry: 2,
  });
}
