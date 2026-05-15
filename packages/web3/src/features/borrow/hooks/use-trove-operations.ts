import { useInfiniteQuery } from "@tanstack/react-query";
import {
  getBorrowRegistry,
  resolveAddressesFromRegistry,
} from "@mento-protocol/mento-sdk";
import { useChainId, usePublicClient } from "wagmi";
import { getTrovesSubgraphUrl } from "../troves-subgraph";

// Mirrors the subgraph's TroveOperationKind enum. Order matches
// `ITroveEvents.Operation` in the Liquity v2 fork's contracts.
export type TroveOperationKind =
  | "openTrove"
  | "closeTrove"
  | "adjustTrove"
  | "adjustTroveInterestRate"
  | "applyPendingDebt"
  | "liquidate"
  | "redeemCollateral"
  | "openTroveAndJoinBatch"
  | "setInterestBatchManager"
  | "removeFromBatch";

export interface TroveOperation {
  id: string;
  operation: TroveOperationKind;
  // Signed deltas from the operation itself, in 18-decimal wei.
  collateralDelta: bigint;
  debtDelta: bigint;
  // Post-op snapshots.
  newCollateral: bigint;
  newDebt: bigint;
  newInterestRate: bigint;
  // Redistribution gains and upfront fee (always non-negative).
  collIncreaseFromRedist: bigint;
  debtIncreaseFromRedist: bigint;
  upfrontFee: bigint;
  // Enriched from same-tx Redemption / Liquidation logs.
  redemptionPrice: bigint | null;
  liquidationPrice: bigint | null;
  // Event metadata.
  blockNumber: bigint;
  timestamp: number; // seconds since epoch, narrowed to number for UI ergonomics
  transactionHash: string;
  initiator: string;
}

// Kinds we don't want to surface in the UI (still indexed; just not shown).
// Matches AGENT_SPEC §7.6.
const HIDDEN_KINDS: readonly TroveOperationKind[] = [
  "openTrove",
  "closeTrove",
  "openTroveAndJoinBatch",
  "setInterestBatchManager",
  "removeFromBatch",
];

interface RawTroveOperation {
  id: string;
  operation: TroveOperationKind;
  collateralDelta: string;
  debtDelta: string;
  newCollateral: string;
  newDebt: string;
  newInterestRate: string;
  collIncreaseFromRedist: string;
  debtIncreaseFromRedist: string;
  upfrontFee: string;
  redemptionPrice: string | null;
  liquidationPrice: string | null;
  blockNumber: string;
  timestamp: string;
  transactionHash: string;
  initiator: string;
}

const TROVE_HISTORY_QUERY = /* GraphQL */ `
  query TroveHistory(
    $troveId: ID!
    $first: Int!
    $skip: Int!
    $hidden: [TroveOperationKind!]
  ) {
    trove(id: $troveId) {
      id
      operations(
        first: $first
        skip: $skip
        orderBy: timestamp
        orderDirection: desc
        where: { operation_not_in: $hidden }
      ) {
        id
        operation
        collateralDelta
        debtDelta
        newCollateral
        newDebt
        newInterestRate
        collIncreaseFromRedist
        debtIncreaseFromRedist
        upfrontFee
        redemptionPrice
        liquidationPrice
        blockNumber
        timestamp
        transactionHash
        initiator
      }
    }
  }
`;

function parseRow(row: RawTroveOperation): TroveOperation {
  return {
    id: row.id,
    operation: row.operation,
    collateralDelta: BigInt(row.collateralDelta),
    debtDelta: BigInt(row.debtDelta),
    newCollateral: BigInt(row.newCollateral),
    newDebt: BigInt(row.newDebt),
    newInterestRate: BigInt(row.newInterestRate),
    collIncreaseFromRedist: BigInt(row.collIncreaseFromRedist),
    debtIncreaseFromRedist: BigInt(row.debtIncreaseFromRedist),
    upfrontFee: BigInt(row.upfrontFee),
    redemptionPrice:
      row.redemptionPrice === null ? null : BigInt(row.redemptionPrice),
    liquidationPrice:
      row.liquidationPrice === null ? null : BigInt(row.liquidationPrice),
    blockNumber: BigInt(row.blockNumber),
    timestamp: Number(row.timestamp),
    transactionHash: row.transactionHash,
    initiator: row.initiator,
  };
}

interface UseTroveOperationsOptions {
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Fetches a trove's operation history (paginated) from the troves subgraph
 * for the current chain. Returns operations newest-first, with the hidden
 * kinds (open/close/batch joins) filtered out at the query level.
 *
 * The URL trove id (`0x...`) gets namespaced with the branch's TroveManager
 * address to match the subgraph's entity id format
 * (`<troveManager>:<collIndex>:<troveIdHex>`).
 */
export function useTroveOperations(
  troveId: string | undefined,
  symbol = "GBPm",
  options: UseTroveOperationsOptions = {},
) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const subgraphUrl = getTrovesSubgraphUrl(chainId);
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  return useInfiniteQuery({
    queryKey: ["borrow", "troveOperations", symbol, chainId, troveId, pageSize],
    enabled: !!publicClient && !!troveId && !!subgraphUrl,
    initialPageParam: 0,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const skip = pageParam;
      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient!,
        registryAddress,
      );
      const troveManager = addresses.troveManager.toLowerCase();
      const normalizedTroveId = troveId!.toLowerCase();
      const subgraphId = `${troveManager}:0:${normalizedTroveId}`;

      const response = await fetch(subgraphUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: TROVE_HISTORY_QUERY,
          variables: {
            troveId: subgraphId,
            first: pageSize,
            skip,
            hidden: HIDDEN_KINDS,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Troves subgraph responded ${response.status} ${response.statusText}`,
        );
      }

      const payload = (await response.json()) as {
        data?: {
          trove: { id: string; operations: RawTroveOperation[] } | null;
        };
        errors?: Array<{ message: string }>;
      };

      if (payload.errors && payload.errors.length > 0) {
        throw new Error(payload.errors.map((e) => e.message).join("; "));
      }

      const rows = payload.data?.trove?.operations ?? [];
      return rows.map(parseRow);
    },
    getNextPageParam: (lastPage, allPages) => {
      // If the last page was full, there might be more — bump skip.
      if (lastPage.length < pageSize) return undefined;
      return allPages.reduce((n, page) => n + page.length, 0);
    },
    refetchInterval: 30_000,
  });
}
