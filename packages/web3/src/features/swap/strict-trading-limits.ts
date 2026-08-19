import {
  BROKER_ABI,
  FPMM_ABI,
  PoolType,
  calculateTradingLimitsV1,
  calculateTradingLimitsV2,
  computeLimitId,
  tryGetContractAddress,
  type Pool,
  type TradingLimit,
  type TradingLimitsConfigV1,
  type TradingLimitsConfigV2,
  type TradingLimitsStateV1,
  type TradingLimitsStateV2,
} from "@mento-protocol/mento-sdk";
import type { PublicClient } from "viem";

export const TRADING_LIMITS_UNAVAILABLE_MESSAGE =
  "Unable to verify trading limits. Please try again.";

export type TradingLimitTier = "L0" | "L1" | "LG";
export type TaggedTradingLimit = TradingLimit & { tier: TradingLimitTier };

export type TradingLimitsPublicClient = Pick<PublicClient, "readContract">;

function tagCalculatedLimits(
  limits: TradingLimit[],
  tiers: TradingLimitTier[],
): TaggedTradingLimit[] {
  return limits.map((limit, index) => {
    const tier = tiers[index];
    if (!tier) {
      throw new Error(TRADING_LIMITS_UNAVAILABLE_MESSAGE);
    }
    return { ...limit, tier };
  });
}

async function readFpmmTokenLimits(
  publicClient: TradingLimitsPublicClient,
  poolAddress: `0x${string}`,
  token: `0x${string}`,
): Promise<TaggedTradingLimit[]> {
  const [configTuple, stateTuple] = await publicClient.readContract({
    address: poolAddress,
    abi: FPMM_ABI,
    functionName: "getTradingLimits",
    args: [token],
  });
  const config: TradingLimitsConfigV2 = {
    limit0: configTuple.limit0,
    limit1: configTuple.limit1,
    decimals: configTuple.decimals,
  };
  const state: TradingLimitsStateV2 = {
    lastUpdated0: Number(stateTuple.lastUpdated0),
    lastUpdated1: Number(stateTuple.lastUpdated1),
    netflow0: stateTuple.netflow0,
    netflow1: stateTuple.netflow1,
  };
  const tiers: TradingLimitTier[] = [];
  if (config.limit0 > 0n) tiers.push("L0");
  if (config.limit1 > 0n) tiers.push("L1");

  return tagCalculatedLimits(
    calculateTradingLimitsV2(config, state, token),
    tiers,
  );
}

async function readVirtualTokenLimits(
  publicClient: TradingLimitsPublicClient,
  brokerAddress: `0x${string}`,
  exchangeId: string,
  token: `0x${string}`,
): Promise<TaggedTradingLimit[]> {
  const limitId = computeLimitId(exchangeId, token);
  const [configResult, stateResult] = await Promise.all([
    publicClient.readContract({
      address: brokerAddress,
      abi: BROKER_ABI,
      functionName: "tradingLimitsConfig",
      args: [limitId],
    }),
    publicClient.readContract({
      address: brokerAddress,
      abi: BROKER_ABI,
      functionName: "tradingLimitsState",
      args: [limitId],
    }),
  ]);
  const configTuple = configResult as readonly [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const stateTuple = stateResult as readonly [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const config: TradingLimitsConfigV1 = {
    timestep0: Number(configTuple[0]),
    timestep1: Number(configTuple[1]),
    limit0: configTuple[2],
    limit1: configTuple[3],
    limitGlobal: configTuple[4],
    flags: Number(configTuple[5]),
  };
  const state: TradingLimitsStateV1 = {
    lastUpdated0: Number(stateTuple[0]),
    lastUpdated1: Number(stateTuple[1]),
    netflow0: stateTuple[2],
    netflow1: stateTuple[3],
    netflowGlobal: stateTuple[4],
  };
  const tiers: TradingLimitTier[] = [];
  if ((config.flags & 0x01) !== 0 && config.limit0 > 0n) tiers.push("L0");
  if ((config.flags & 0x02) !== 0 && config.limit1 > 0n) tiers.push("L1");
  if ((config.flags & 0x04) !== 0 && config.limitGlobal > 0n) tiers.push("LG");

  return tagCalculatedLimits(
    calculateTradingLimitsV1(config, state, token, 0),
    tiers,
  );
}

export async function readPoolTradingLimitsStrict(
  publicClient: TradingLimitsPublicClient,
  chainId: number,
  pool: Pool,
): Promise<TaggedTradingLimit[]> {
  const token0 = pool.token0 as `0x${string}`;
  const token1 = pool.token1 as `0x${string}`;

  if (pool.poolType === PoolType.FPMM) {
    const [token0Limits, token1Limits] = await Promise.all([
      readFpmmTokenLimits(publicClient, pool.poolAddr as `0x${string}`, token0),
      readFpmmTokenLimits(publicClient, pool.poolAddr as `0x${string}`, token1),
    ]);
    return [...token0Limits, ...token1Limits];
  }

  if (pool.poolType !== PoolType.Virtual || !pool.exchangeId) {
    throw new Error(TRADING_LIMITS_UNAVAILABLE_MESSAGE);
  }
  const brokerAddress = tryGetContractAddress(chainId, "Broker");
  if (!brokerAddress) {
    throw new Error(TRADING_LIMITS_UNAVAILABLE_MESSAGE);
  }

  const [token0Limits, token1Limits] = await Promise.all([
    readVirtualTokenLimits(
      publicClient,
      brokerAddress as `0x${string}`,
      pool.exchangeId,
      token0,
    ),
    readVirtualTokenLimits(
      publicClient,
      brokerAddress as `0x${string}`,
      pool.exchangeId,
      token1,
    ),
  ]);
  return [...token0Limits, ...token1Limits];
}
