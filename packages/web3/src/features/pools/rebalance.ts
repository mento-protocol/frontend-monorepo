import type { ChainId } from "@/config/chains";
import { getPublicClient } from "@/features/sdk";
import { logger } from "@/utils/logger";
import type {
  PoolRebalancePreview,
  RebalanceDetails,
  RebalanceTransaction,
  TokenApproval,
} from "@mento-protocol/mento-sdk";
import { encodeFunctionData, getAddress, parseAbi, type Address } from "viem";
import type { PoolDisplay } from "./types";

const LIQUIDITY_STRATEGY_ABI = parseAbi([
  "function poolConfigs(address pool) view returns (bool isToken0Debt, uint32 lastRebalance, uint32 rebalanceCooldown, address protocolFeeRecipient, uint64 liquiditySourceIncentiveExpansion, uint64 protocolIncentiveExpansion, uint64 liquiditySourceIncentiveContraction, uint64 protocolIncentiveContraction)",
  "function determineAction(address pool) view returns ((address pool, (uint256 reserveNum, uint256 reserveDen) reserves, (uint256 oracleNum, uint256 oracleDen, bool poolPriceAbove, uint16 rebalanceThreshold) prices, address token0, address token1, uint64 token0Dec, uint64 token1Dec, bool isToken0Debt, (uint64 liquiditySourceIncentiveExpansion, uint64 protocolIncentiveExpansion, uint64 liquiditySourceIncentiveContraction, uint64 protocolIncentiveContraction) incentives) ctx, (uint8 dir, uint256 amount0Out, uint256 amount1Out, uint256 amountOwedToPool) action)",
  "function rebalance(address pool)",
] as const);

const ERC20_REBALANCE_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const);

const FEE_DENOMINATOR = 10n ** 18n;
const ZERO_CALL_VALUE = "0";
const REVERT_SELECTOR_REGEX = /0x[a-fA-F0-9]{8,}/g;

type TupleLike = readonly unknown[] | Record<string, unknown>;

function isTupleLike(value: unknown): value is TupleLike {
  return Array.isArray(value) || (!!value && typeof value === "object");
}

function getTupleValue<T>(
  value: unknown,
  key: string,
  index: number,
  label: string,
): T {
  if (!isTupleLike(value)) {
    throw new Error(`Invalid ${label} shape`);
  }

  if (Array.isArray(value)) {
    const item = value[index];
    if (item !== undefined) return item as T;
  }

  const record = value as Record<string, unknown>;
  if (record[key] !== undefined) return record[key] as T;
  if (record[String(index)] !== undefined) return record[String(index)] as T;

  throw new Error(`Missing ${label}.${key}`);
}

function toBigIntValue(value: unknown, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error(`Invalid bigint for ${label}`);
}

function toNumberValue(value: unknown, label: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  throw new Error(`Invalid number for ${label}`);
}

function toBooleanValue(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`Invalid boolean for ${label}`);
}

function toAddressValue(value: unknown, label: string): Address {
  if (typeof value !== "string") {
    throw new Error(`Invalid address for ${label}`);
  }
  return getAddress(value);
}

function parseDirection(value: unknown): PoolRebalancePreview["direction"] {
  if (value === "Expand" || value === "Contract") return value;

  const normalized = toNumberValue(value, "direction");
  if (normalized === 0) return "Expand";
  if (normalized === 1) return "Contract";

  throw new Error(`Unsupported liquidity strategy direction: ${normalized}`);
}

function parsePoolConfig(raw: unknown): PoolRebalancePreview["config"] {
  return {
    isToken0Debt: toBooleanValue(
      getTupleValue(raw, "isToken0Debt", 0, "poolConfigs"),
      "poolConfigs.isToken0Debt",
    ),
    lastRebalance: toNumberValue(
      getTupleValue(raw, "lastRebalance", 1, "poolConfigs"),
      "poolConfigs.lastRebalance",
    ),
    rebalanceCooldown: toNumberValue(
      getTupleValue(raw, "rebalanceCooldown", 2, "poolConfigs"),
      "poolConfigs.rebalanceCooldown",
    ),
    protocolFeeRecipient: toAddressValue(
      getTupleValue(raw, "protocolFeeRecipient", 3, "poolConfigs"),
      "poolConfigs.protocolFeeRecipient",
    ),
    liquiditySourceIncentiveExpansion: toBigIntValue(
      getTupleValue(raw, "liquiditySourceIncentiveExpansion", 4, "poolConfigs"),
      "poolConfigs.liquiditySourceIncentiveExpansion",
    ),
    protocolIncentiveExpansion: toBigIntValue(
      getTupleValue(raw, "protocolIncentiveExpansion", 5, "poolConfigs"),
      "poolConfigs.protocolIncentiveExpansion",
    ),
    liquiditySourceIncentiveContraction: toBigIntValue(
      getTupleValue(
        raw,
        "liquiditySourceIncentiveContraction",
        6,
        "poolConfigs",
      ),
      "poolConfigs.liquiditySourceIncentiveContraction",
    ),
    protocolIncentiveContraction: toBigIntValue(
      getTupleValue(raw, "protocolIncentiveContraction", 7, "poolConfigs"),
      "poolConfigs.protocolIncentiveContraction",
    ),
  };
}

function parseContext(raw: unknown): PoolRebalancePreview["context"] {
  const reserves = getTupleValue<unknown>(raw, "reserves", 1, "context");
  const prices = getTupleValue<unknown>(raw, "prices", 2, "context");
  const incentives = getTupleValue<unknown>(raw, "incentives", 8, "context");

  return {
    pool: toAddressValue(
      getTupleValue(raw, "pool", 0, "context"),
      "context.pool",
    ),
    reserves: {
      reserveNum: toBigIntValue(
        getTupleValue(reserves, "reserveNum", 0, "context.reserves"),
        "context.reserves.reserveNum",
      ),
      reserveDen: toBigIntValue(
        getTupleValue(reserves, "reserveDen", 1, "context.reserves"),
        "context.reserves.reserveDen",
      ),
    },
    prices: {
      oracleNum: toBigIntValue(
        getTupleValue(prices, "oracleNum", 0, "context.prices"),
        "context.prices.oracleNum",
      ),
      oracleDen: toBigIntValue(
        getTupleValue(prices, "oracleDen", 1, "context.prices"),
        "context.prices.oracleDen",
      ),
      poolPriceAbove: toBooleanValue(
        getTupleValue(prices, "poolPriceAbove", 2, "context.prices"),
        "context.prices.poolPriceAbove",
      ),
      rebalanceThreshold: toNumberValue(
        getTupleValue(prices, "rebalanceThreshold", 3, "context.prices"),
        "context.prices.rebalanceThreshold",
      ),
    },
    token0: toAddressValue(
      getTupleValue(raw, "token0", 3, "context"),
      "context.token0",
    ),
    token1: toAddressValue(
      getTupleValue(raw, "token1", 4, "context"),
      "context.token1",
    ),
    token0Dec: toBigIntValue(
      getTupleValue(raw, "token0Dec", 5, "context"),
      "context.token0Dec",
    ),
    token1Dec: toBigIntValue(
      getTupleValue(raw, "token1Dec", 6, "context"),
      "context.token1Dec",
    ),
    isToken0Debt: toBooleanValue(
      getTupleValue(raw, "isToken0Debt", 7, "context"),
      "context.isToken0Debt",
    ),
    incentives: {
      liquiditySourceIncentiveExpansion: toBigIntValue(
        getTupleValue(
          incentives,
          "liquiditySourceIncentiveExpansion",
          0,
          "context.incentives",
        ),
        "context.incentives.liquiditySourceIncentiveExpansion",
      ),
      protocolIncentiveExpansion: toBigIntValue(
        getTupleValue(
          incentives,
          "protocolIncentiveExpansion",
          1,
          "context.incentives",
        ),
        "context.incentives.protocolIncentiveExpansion",
      ),
      liquiditySourceIncentiveContraction: toBigIntValue(
        getTupleValue(
          incentives,
          "liquiditySourceIncentiveContraction",
          2,
          "context.incentives",
        ),
        "context.incentives.liquiditySourceIncentiveContraction",
      ),
      protocolIncentiveContraction: toBigIntValue(
        getTupleValue(
          incentives,
          "protocolIncentiveContraction",
          3,
          "context.incentives",
        ),
        "context.incentives.protocolIncentiveContraction",
      ),
    },
  };
}

function parseAction(raw: unknown): PoolRebalancePreview["action"] {
  return {
    dir: parseDirection(getTupleValue(raw, "dir", 0, "action")),
    amount0Out: toBigIntValue(
      getTupleValue(raw, "amount0Out", 1, "action"),
      "action.amount0Out",
    ),
    amount1Out: toBigIntValue(
      getTupleValue(raw, "amount1Out", 2, "action"),
      "action.amount1Out",
    ),
    amountOwedToPool: toBigIntValue(
      getTupleValue(raw, "amountOwedToPool", 3, "action"),
      "action.amountOwedToPool",
    ),
  };
}

function buildPreview(
  pool: PoolDisplay,
  strategyAddress: Address,
  config: PoolRebalancePreview["config"],
  context: PoolRebalancePreview["context"],
  action: PoolRebalancePreview["action"],
): PoolRebalancePreview | null {
  const debtToken = context.isToken0Debt ? context.token0 : context.token1;
  const collateralToken = context.isToken0Debt
    ? context.token1
    : context.token0;
  const inputToken = action.dir === "Expand" ? debtToken : collateralToken;
  const outputToken = action.dir === "Expand" ? collateralToken : debtToken;
  const amountTransferredValue =
    action.amount0Out > 0n ? action.amount0Out : action.amount1Out;

  if (action.amountOwedToPool <= 0n || amountTransferredValue <= 0n) {
    return null;
  }

  const protocolRate =
    action.dir === "Expand"
      ? config.protocolIncentiveExpansion
      : config.protocolIncentiveContraction;
  const liquiditySourceRate =
    action.dir === "Expand"
      ? config.liquiditySourceIncentiveExpansion
      : config.liquiditySourceIncentiveContraction;

  const protocolIncentiveAmount =
    (amountTransferredValue * protocolRate) / FEE_DENOMINATOR;
  const liquiditySourceBase =
    amountTransferredValue > protocolIncentiveAmount
      ? amountTransferredValue - protocolIncentiveAmount
      : 0n;
  const liquiditySourceIncentiveAmount =
    (liquiditySourceBase * liquiditySourceRate) / FEE_DENOMINATOR;

  return {
    poolAddress: pool.poolAddr,
    strategyAddress,
    direction: action.dir,
    config,
    context,
    action,
    inputToken,
    outputToken,
    amountRequired: {
      token: inputToken,
      amount: action.amountOwedToPool,
    },
    amountTransferred: {
      token: outputToken,
      amount: amountTransferredValue,
    },
    protocolIncentive: {
      token: outputToken,
      amount: protocolIncentiveAmount,
    },
    liquiditySourceIncentive: {
      token: outputToken,
      amount: liquiditySourceIncentiveAmount,
    },
    approvalToken: inputToken,
    approvalSpender: strategyAddress,
    approvalAmount: action.amountOwedToPool,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractRevertSelector(error: unknown): string | null {
  const seen = new Set<unknown>();

  function visit(value: unknown, depth: number): string | null {
    if (depth > 4 || value == null) return null;

    if (typeof value === "string") {
      const matches = value.match(REVERT_SELECTOR_REGEX);
      if (!matches || matches.length === 0) return null;
      const candidate = matches.find((match) => match.length >= 10);
      return candidate ? candidate.slice(0, 10) : null;
    }

    if (typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);

    const obj = value as Record<string, unknown>;
    for (const key of [
      "data",
      "details",
      "shortMessage",
      "message",
      "cause",
      "error",
    ]) {
      const selector = visit(obj[key], depth + 1);
      if (selector) return selector;
    }

    return null;
  }

  return visit(error, 0);
}

function buildApprovalParams(
  token: Address,
  amount: bigint,
  spender: Address,
): TokenApproval["params"] {
  return {
    to: token,
    data: encodeFunctionData({
      abi: ERC20_REBALANCE_ABI,
      functionName: "approve",
      args: [spender, amount],
    }),
    value: ZERO_CALL_VALUE,
  };
}

function buildRebalanceParams(
  poolAddress: Address,
  strategyAddress: Address,
): RebalanceDetails["params"] {
  return {
    to: strategyAddress,
    data: encodeFunctionData({
      abi: LIQUIDITY_STRATEGY_ABI,
      functionName: "rebalance",
      args: [poolAddress],
    }),
    value: ZERO_CALL_VALUE,
  };
}

async function getAllowance(
  chainId: ChainId,
  token: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return (await getPublicClient(chainId).readContract({
    address: token,
    abi: ERC20_REBALANCE_ABI,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
}

export async function getPoolRebalancePreview(
  pool: PoolDisplay,
  account?: Address,
): Promise<PoolRebalancePreview | null> {
  const strategy = pool.rebalancing?.liquidityStrategy;

  if (
    pool.poolType !== "FPMM" ||
    !strategy ||
    pool.rebalancing?.canRebalance === false
  ) {
    return null;
  }

  const publicClient = getPublicClient(pool.chainId);
  let strategyAddressForLog = strategy;

  try {
    const strategyAddress = getAddress(strategy);
    strategyAddressForLog = strategyAddress;

    const [configRaw, determineActionRaw] = await Promise.all([
      publicClient.readContract({
        address: strategyAddress,
        abi: LIQUIDITY_STRATEGY_ABI,
        functionName: "poolConfigs",
        args: [pool.poolAddr as Address],
      }),
      publicClient.readContract({
        address: strategyAddress,
        abi: LIQUIDITY_STRATEGY_ABI,
        functionName: "determineAction",
        args: [pool.poolAddr as Address],
        ...(account && { account }),
      }),
    ]);

    const config = parsePoolConfig(configRaw);
    const context = parseContext(
      getTupleValue(determineActionRaw, "ctx", 0, "determineAction"),
    );
    const action = parseAction(
      getTupleValue(determineActionRaw, "action", 1, "determineAction"),
    );

    return buildPreview(pool, strategyAddress, config, context, action);
  } catch (error) {
    logger.warn("Failed to fetch pool rebalance preview", {
      poolAddress: pool.poolAddr,
      strategyAddress: strategyAddressForLog,
      revertSelector: extractRevertSelector(error),
      errorMessage: getErrorMessage(error),
    });
    return null;
  }
}

export async function buildPoolRebalanceTransaction(
  pool: PoolDisplay,
  owner: Address,
): Promise<RebalanceTransaction> {
  const preview = await getPoolRebalancePreview(pool);

  if (!preview) {
    throw new Error(
      `Pool ${pool.poolAddr} is not currently rebalanceable or does not have a supported liquidity strategy.`,
    );
  }

  const currentAllowance = await getAllowance(
    pool.chainId,
    getAddress(preview.approvalToken),
    owner,
    getAddress(preview.approvalSpender),
  );

  logger.info("Rebalance allowance check", {
    poolAddress: pool.poolAddr,
    approvalToken: preview.approvalToken,
    approvalSpender: preview.approvalSpender,
    currentAllowance: currentAllowance.toString(),
    requiredAmount: preview.approvalAmount.toString(),
    needsApproval: currentAllowance < preview.approvalAmount,
    direction: preview.direction,
  });

  const approval =
    currentAllowance < preview.approvalAmount
      ? {
          token: preview.approvalToken,
          amount: preview.approvalAmount,
          params: buildApprovalParams(
            getAddress(preview.approvalToken),
            preview.approvalAmount,
            getAddress(preview.approvalSpender),
          ),
        }
      : null;

  return {
    approval,
    rebalance: {
      params: buildRebalanceParams(
        preview.poolAddress as Address,
        getAddress(preview.strategyAddress),
      ),
      poolAddress: preview.poolAddress,
      strategyAddress: preview.strategyAddress,
      inputToken: preview.inputToken,
      outputToken: preview.outputToken,
      amountRequired: preview.amountRequired.amount,
      expectedAmountTransferred: preview.amountTransferred.amount,
      expectedProtocolIncentive: preview.protocolIncentive.amount,
      expectedLiquiditySourceIncentive: preview.liquiditySourceIncentive.amount,
      approvalToken: preview.approvalToken,
      approvalSpender: preview.approvalSpender,
      approvalAmount: preview.approvalAmount,
      direction: preview.direction,
    },
  };
}
