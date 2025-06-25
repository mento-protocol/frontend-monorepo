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
const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// FPMM Factory ABI
const FPMM_FACTORY_ABI = parseAbi([
  "function deployedFPMMAddresses() view returns (address[])",
]);

// Contract addresses for V3
const V3_LIQUIDITY_STRATEGY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0xd202154b1f7d5f1Aa065CdFe47B207A7be514ca6",
};

const V3_FPMM_FACTORY = {
  [celo.id]: "0x0000000000000000000000000000000000000000",
  [celoAlfajores.id]: "0xd8098494a749a3fDAD2D2e7Fa5272D8f274D8FF6",
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
      const fpmmFactoryAddress =
        V3_FPMM_FACTORY[chainId as keyof typeof V3_FPMM_FACTORY];

      // Create public client for the current chain
      const publicClient = createPublicClient({
        chain: chainId === celo.id ? celo : celoAlfajores,
        transport: http(),
      });

      let poolAddresses: `0x${string}`[] = [];

      // Get pools from liquidity strategy if available
      if (
        liquidityStrategyAddress &&
        liquidityStrategyAddress !==
          "0x0000000000000000000000000000000000000000"
      ) {
        try {
          const strategyPools = await publicClient.readContract({
            address: liquidityStrategyAddress as `0x${string}`,
            abi: LIQUIDITY_STRATEGY_ABI,
            functionName: "getPools",
          });
          poolAddresses = [...poolAddresses, ...strategyPools];
        } catch (error) {
          console.error("Error fetching pools from liquidity strategy:", error);
        }
      }

      // Get pools from FPMM factory if available
      if (
        fpmmFactoryAddress &&
        fpmmFactoryAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        try {
          const factoryPools = await publicClient.readContract({
            address: fpmmFactoryAddress as `0x${string}`,
            abi: FPMM_FACTORY_ABI,
            functionName: "deployedFPMMAddresses",
          });
          poolAddresses = [...poolAddresses, ...factoryPools];
        } catch (error) {
          console.error("Error fetching pools from FPMM factory:", error);
        }
      }

      // Remove duplicates
      poolAddresses = [...new Set(poolAddresses)];

      if (poolAddresses.length === 0) {
        return [];
      }

      const pools: V3Pool[] = [];
      const now = Math.floor(Date.now() / 1000);

      // Fetch data for each pool
      for (const poolAddress of poolAddresses) {
        try {
          // Try to get pool configuration from liquidity strategy (might not exist for factory pools)
          let lastRebalance = BigInt(0);
          let rebalanceCooldown = BigInt(0);
          let rebalanceIncentive = BigInt(0);
          let isInLiquidityStrategy = false;

          if (
            liquidityStrategyAddress &&
            liquidityStrategyAddress !==
              "0x0000000000000000000000000000000000000000"
          ) {
            try {
              const poolConfig = await publicClient.readContract({
                address: liquidityStrategyAddress as `0x${string}`,
                abi: LIQUIDITY_STRATEGY_ABI,
                functionName: "fpmmPoolConfigs",
                args: [poolAddress],
              });
              [lastRebalance, rebalanceCooldown, rebalanceIncentive] =
                poolConfig;
              // Check if pool actually has configuration (not just zero values)
              isInLiquidityStrategy =
                lastRebalance > BigInt(0) ||
                rebalanceCooldown > BigInt(0) ||
                rebalanceIncentive > BigInt(0);
            } catch (error: any) {
              // Pool not in liquidity strategy
              console.log(`Pool ${poolAddress} not in liquidity strategy`);
              isInLiquidityStrategy = false;
            }
          }

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
          let token0Decimals = 0;
          let token1Decimals = 0;

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

          try {
            token0Decimals = await publicClient.readContract({
              address: token0Address,
              abi: ERC20_ABI,
              functionName: "decimals",
            });
          } catch (error) {
            console.error(
              `Error getting decimals for token 0 (${token0Address}):`,
              error,
            );
            token0Decimals = 18;
          }

          try {
            token1Decimals = await publicClient.readContract({
              address: token1Address,
              abi: ERC20_ABI,
              functionName: "decimals",
            });
          } catch (error) {
            console.error(
              `Error getting decimals for token 1 (${token1Address}):`,
              error,
            );
            token1Decimals = 18;
          }

          // Parse metadata and prices
          const [decimal0, decimal1, reserve0, reserve1] = metadata;
          const [oraclePrice, poolPrice] = prices;

          // Calculate deviation first
          const oraclePriceNum = parseFloat(formatUnits(oraclePrice, 18));
          const poolPriceNum = parseFloat(formatUnits(poolPrice, 18));
          const deviation =
            oraclePriceNum > 0
              ? ((poolPriceNum - oraclePriceNum) / oraclePriceNum) * 100
              : 0;

          // Calculate if rebalance is possible (only if pool is in liquidity strategy)
          let canRebalance = false;
          let cooldownEnds = 0;
          let thresholdAboveNum = 0;
          let thresholdBelowNum = 0;

          if (isInLiquidityStrategy) {
            cooldownEnds = Number(lastRebalance) + Number(rebalanceCooldown);
            const cooldownPassed = now > cooldownEnds;

            // Parse thresholds to check deviation
            thresholdAboveNum = parseFloat(formatUnits(thresholdAbove, 2));
            thresholdBelowNum = parseFloat(formatUnits(thresholdBelow, 2));

            // Check if deviation is outside thresholds
            const deviationOutsideThresholds =
              deviation > thresholdAboveNum || deviation < -thresholdBelowNum;

            // Can rebalance if cooldown passed AND deviation is outside thresholds
            canRebalance = cooldownPassed && deviationOutsideThresholds;
          }

          console.log("PoolAddress", poolAddress);
          console.log("token0Symbol", token0Symbol);
          console.log("token1Symbol", token1Symbol);
          console.log("token0Decimals", token0Decimals);
          console.log("token1Decimals", token1Decimals);
          console.log("reserve0", reserve0);
          console.log("reserve1", reserve1);

          // Format reserve amounts using decimals from FPMM metadata
          const reserve0Formatted = parseFloat(
            formatUnits(reserve0, token0Decimals),
          );
          const reserve1Formatted = parseFloat(
            formatUnits(reserve1, token1Decimals),
          );

          console.log("reserve0Formatted", reserve0Formatted);
          console.log("reserve1Formatted", reserve1Formatted);

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
            reserve0: formatUnits(reserve0, token0Decimals),
            reserve1: formatUnits(reserve1, token1Decimals),
            oraclePrice: formatUnits(oraclePrice, 18),
            poolPrice: formatUnits(poolPrice, 18),
            deviation,
            lastRebalance: isInLiquidityStrategy
              ? new Date(Number(lastRebalance) * 1000).toLocaleString()
              : "N/A",
            rebalanceCooldown: isInLiquidityStrategy
              ? new Date(cooldownEnds * 1000).toLocaleString()
              : "N/A",
            rebalanceIncentive: isInLiquidityStrategy
              ? formatUnits(rebalanceIncentive, 16) // Basis points to percentage
              : "N/A",
            thresholdAbove: isInLiquidityStrategy
              ? formatUnits(thresholdAbove, 2) // Convert from basis points (500 = 5.00%)
              : "N/A",
            thresholdBelow: isInLiquidityStrategy
              ? formatUnits(thresholdBelow, 2) // Convert from basis points (500 = 5.00%)
              : "N/A",
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
              currentPoolPrice: `${poolPriceNum.toFixed(4)}  ${token1Symbol} per ${token0Symbol}`,
              oracleTargetPrice: `${oraclePriceNum.toFixed(4)} ${token1Symbol} per ${token0Symbol}`,
              thresholds: isInLiquidityStrategy
                ? `+${formatUnits(thresholdAbove, 2)}% / -${formatUnits(thresholdBelow, 2)}%`
                : "N/A",
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
      (!!V3_LIQUIDITY_STRATEGY[chainId as keyof typeof V3_LIQUIDITY_STRATEGY] ||
        !!V3_FPMM_FACTORY[chainId as keyof typeof V3_FPMM_FACTORY]),
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Refetch every 30 seconds
    retry: 2,
  });
}
