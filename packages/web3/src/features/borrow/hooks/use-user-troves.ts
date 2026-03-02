import { useQuery } from "@tanstack/react-query";
import { getBorrowRegistry } from "@mento-protocol/mento-sdk";
import { resolveAddressesFromRegistry } from "@mento-protocol/mento-sdk/dist/services/borrow/borrowHelpers";
import { Address, parseAbi, zeroAddress } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import type { BorrowPosition, TroveStatus } from "../types";

const TROVE_MANAGER_ABI = parseAbi([
  "function getTroveIdsCount() view returns (uint256)",
  "function getTroveFromTroveIdsArray(uint256 _index) view returns (uint256)",
  "function getLatestTroveData(uint256 _troveId) view returns ((uint256 entireDebt, uint256 entireColl, uint256 redistBoldDebtGain, uint256 redistCollGain, uint256 accruedInterest, uint256 recordedDebt, uint256 annualInterestRate, uint256 weightedRecordedDebt, uint256 accruedBatchManagementFee, uint256 lastInterestRateAdjTime))",
  "function Troves(uint256 _id) view returns (uint256 debt, uint256 coll, uint256 stake, uint8 status, uint64 arrayIndex, uint64 lastDebtUpdateTime, uint64 lastInterestRateAdjTime, uint256 annualInterestRate, address interestBatchManager, uint256 batchDebtShares)",
]);

const TROVE_NFT_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

type LatestTroveDataLike =
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

type TrovesDataLike =
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

function formatTroveId(troveId: bigint): string {
  return `0x${troveId.toString(16)}`;
}

function parseBorrowPositionSafe(
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

export function useUserTroves(symbol = "GBPm") {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });

  return useQuery<BorrowPosition[]>({
    queryKey: ["borrow", "userTroves", symbol, chainId, address],
    queryFn: async () => {
      const owner = address!;
      const ownerLc = owner.toLowerCase();

      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient!,
        registryAddress,
      );

      const troveManager = addresses.troveManager as Address;
      const troveNft = addresses.troveNFT as Address;

      const troveCount = (await publicClient!.readContract({
        address: troveManager,
        abi: TROVE_MANAGER_ABI,
        functionName: "getTroveIdsCount",
      })) as bigint;

      const ownedTroveIds: bigint[] = [];

      for (let i = 0n; i < troveCount; i++) {
        const troveId = (await publicClient!.readContract({
          address: troveManager,
          abi: TROVE_MANAGER_ABI,
          functionName: "getTroveFromTroveIdsArray",
          args: [i],
        })) as bigint;

        const troveOwner = (await publicClient!.readContract({
          address: troveNft,
          abi: TROVE_NFT_ABI,
          functionName: "ownerOf",
          args: [troveId],
        })) as Address;

        if (troveOwner.toLowerCase() === ownerLc) {
          ownedTroveIds.push(troveId);
        }
      }

      return Promise.all(
        ownedTroveIds.map(async (troveId) => {
          const [latestData, trovesData] = await Promise.all([
            publicClient!.readContract({
              address: troveManager,
              abi: TROVE_MANAGER_ABI,
              functionName: "getLatestTroveData",
              args: [troveId],
            }),
            publicClient!.readContract({
              address: troveManager,
              abi: TROVE_MANAGER_ABI,
              functionName: "Troves",
              args: [troveId],
            }),
          ]);

          return parseBorrowPositionSafe(
            troveId,
            latestData as LatestTroveDataLike,
            trovesData as TrovesDataLike,
          );
        }),
      );
    },
    enabled: !!publicClient && !!address,
    refetchInterval: 15_000,
  });
}
