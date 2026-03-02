import { type Address, parseAbi, zeroAddress } from "viem";
import type { BorrowPosition, TroveStatus } from "../types";

export const TROVE_MANAGER_ABI = parseAbi([
  "function getTroveIdsCount() view returns (uint256)",
  "function getTroveFromTroveIdsArray(uint256 _index) view returns (uint256)",
  "function getLatestTroveData(uint256 _troveId) view returns ((uint256 entireDebt, uint256 entireColl, uint256 redistBoldDebtGain, uint256 redistCollGain, uint256 accruedInterest, uint256 recordedDebt, uint256 annualInterestRate, uint256 weightedRecordedDebt, uint256 accruedBatchManagementFee, uint256 lastInterestRateAdjTime))",
  "function Troves(uint256 _id) view returns (uint256 debt, uint256 coll, uint256 stake, uint8 status, uint64 arrayIndex, uint64 lastDebtUpdateTime, uint64 lastInterestRateAdjTime, uint256 annualInterestRate, address interestBatchManager, uint256 batchDebtShares)",
]);

export const TROVE_NFT_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

export type LatestTroveDataLike =
  | {
      entireDebt?: unknown;
      entireColl?: unknown;
      redistBoldDebtGain?: unknown;
      redistCollGain?: unknown;
      accruedInterest?: unknown;
      recordedDebt?: unknown;
      annualInterestRate?: unknown;
      accruedBatchManagementFee?: unknown;
      lastInterestRateAdjTime?: unknown;
    }
  | readonly unknown[];

export type TrovesDataLike =
  | {
      status?: unknown;
      lastDebtUpdateTime?: unknown;
      interestBatchManager?: unknown;
    }
  | readonly unknown[];

function getField(data: unknown, index: number, key: string): unknown {
  if (Array.isArray(data)) return data[index];
  return (data as Record<string, unknown> | undefined)?.[key];
}

function asBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value !== "bigint") {
    throw new Error(`${fieldName} must be bigint`);
  }
  if (value < 0n) {
    throw new Error(`${fieldName} cannot be negative`);
  }
  return value;
}

function asSafeNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${fieldName} must be a non-negative safe integer`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${fieldName} out of range`);
    }
    return Number(value);
  }
  throw new Error(`${fieldName} must be number or bigint`);
}

function asNullableAddress(value: unknown, fieldName: string): Address | null {
  if (value == null) return null;
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new Error(`${fieldName} must be address`);
  }
  return value as Address;
}

function mapTroveStatus(statusNum: number): TroveStatus {
  switch (statusNum) {
    case 0:
      return "nonExistent";
    case 1:
      return "active";
    case 2:
      return "closedByOwner";
    case 3:
      return "closedByLiquidation";
    case 4:
      return "zombie";
    default:
      throw new Error(`Unknown trove status: ${statusNum}`);
  }
}

export function parseBorrowPositionSafe(
  troveId: bigint,
  latestDataRaw: LatestTroveDataLike,
  trovesDataRaw: TrovesDataLike,
): BorrowPosition {
  const interestBatchManager = asNullableAddress(
    getField(trovesDataRaw, 8, "interestBatchManager"),
    "trovesData.interestBatchManager",
  );

  const status = asSafeNumber(
    getField(trovesDataRaw, 3, "status"),
    "trovesData.status",
  );
  const lastDebtUpdateTime = asSafeNumber(
    getField(trovesDataRaw, 5, "lastDebtUpdateTime"),
    "trovesData.lastDebtUpdateTime",
  );
  const lastInterestRateAdjTime = asSafeNumber(
    getField(latestDataRaw, 9, "lastInterestRateAdjTime"),
    "latestData.lastInterestRateAdjTime",
  );

  return {
    troveId: formatTroveId(troveId),
    collateral: asBigInt(
      getField(latestDataRaw, 1, "entireColl"),
      "latestData.entireColl",
    ),
    debt: asBigInt(
      getField(latestDataRaw, 0, "entireDebt"),
      "latestData.entireDebt",
    ),
    annualInterestRate: asBigInt(
      getField(latestDataRaw, 6, "annualInterestRate"),
      "latestData.annualInterestRate",
    ),
    status: mapTroveStatus(status),
    interestBatchManager:
      !interestBatchManager ||
      interestBatchManager.toLowerCase() === zeroAddress
        ? null
        : interestBatchManager,
    lastDebtUpdateTime,
    lastInterestRateAdjTime,
    redistBoldDebtGain: asBigInt(
      getField(latestDataRaw, 2, "redistBoldDebtGain"),
      "latestData.redistBoldDebtGain",
    ),
    redistCollGain: asBigInt(
      getField(latestDataRaw, 3, "redistCollGain"),
      "latestData.redistCollGain",
    ),
    accruedInterest: asBigInt(
      getField(latestDataRaw, 4, "accruedInterest"),
      "latestData.accruedInterest",
    ),
    recordedDebt: asBigInt(
      getField(latestDataRaw, 5, "recordedDebt"),
      "latestData.recordedDebt",
    ),
    accruedBatchManagementFee: asBigInt(
      getField(latestDataRaw, 8, "accruedBatchManagementFee"),
      "latestData.accruedBatchManagementFee",
    ),
  };
}
