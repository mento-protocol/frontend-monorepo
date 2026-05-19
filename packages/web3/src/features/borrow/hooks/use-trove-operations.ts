import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
  /** Refetch interval in ms. Set to false to disable. */
  refetchInterval?: number | false;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_REFETCH_INTERVAL_MS = 30_000;

/**
 * Fetches a trove's operation history (paginated) from the troves subgraph
 * for the current chain. Returns operations newest-first, with the hidden
 * kinds (open/close/batch joins) filtered out at the query level.
 *
 * The URL trove id (`0x...`) gets namespaced with the branch's TroveManager
 * address to match the subgraph's entity id format
 * (`<troveManager>:<collIndex>:<troveIdHex>`). The TroveManager address is
 * resolved via a separate cached query (staleTime: Infinity) — it's stable
 * for a given (chainId, symbol), so we don't re-resolve it on each page
 * fetch or refetch interval.
 *
 * The hook augments the standard react-query return with an
 * `isUnsupportedChain` flag so the UI can distinguish "no subgraph
 * configured for this chain" from "this trove has no on-chain history"
 * — without that flag the two would collapse to the same empty result.
 */
export function useTroveOperations(
  troveId: string | undefined,
  symbol = "GBPm",
  options: UseTroveOperationsOptions = {},
) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const subgraphUrl = getTrovesSubgraphUrl(chainId);
  const isUnsupportedChain = !subgraphUrl;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const refetchInterval =
    options.refetchInterval !== undefined
      ? options.refetchInterval
      : DEFAULT_REFETCH_INTERVAL_MS;

  // The branch's TroveManager address is fixed for a given (chainId, symbol);
  // it never changes once the deployment is wired. Cache forever and reuse
  // across every page fetch and refetch interval of the operations query.
  const troveManagerQuery = useQuery({
    queryKey: ["borrow", "troveManagerAddress", chainId, symbol],
    enabled: !!publicClient && !isUnsupportedChain,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const registryAddress = getBorrowRegistry(chainId, symbol);
      const addresses = await resolveAddressesFromRegistry(
        publicClient!,
        registryAddress,
      );
      return addresses.troveManager.toLowerCase();
    },
  });

  const troveManager = troveManagerQuery.data;

  const operationsQuery = useInfiniteQuery({
    queryKey: [
      "borrow",
      "troveOperations",
      chainId,
      symbol,
      troveId,
      pageSize,
      troveManager,
    ],
    enabled: !isUnsupportedChain && !!troveId && !!troveManager,
    initialPageParam: 0,
    // Once the user has paged into history, stop auto-refetching. By default
    // `useInfiniteQuery` refetches *every loaded page* on each `refetchInterval`
    // tick, so polling cost scales linearly with page depth — a 6-page history
    // would mean 6 fetches every 30s. The 1st page (most recent activity) is
    // the only one that ever changes; once a user has paged back, they are
    // exploring static history and don't need polling. They can still pull
    // fresh data manually via the returned `refetch()`.
    refetchInterval: (query) => {
      if (refetchInterval === false) return false;
      const pageCount = query.state.data?.pages.length ?? 0;
      if (pageCount > 1) return false;
      return refetchInterval;
    },
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const subgraphId = `${troveManager!}:0:${troveId!.toLowerCase()}`;

      const response = await fetch(subgraphUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: TROVE_HISTORY_QUERY,
          variables: {
            troveId: subgraphId,
            first: pageSize,
            skip: pageParam,
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
  });

  return {
    ...operationsQuery,
    /** True when the current chain has no troves subgraph configured. */
    isUnsupportedChain,
    /**
     * True while *either* the TroveManager resolution OR the first
     * subgraph page is still loading. Without this merge, the
     * operations query reports `isLoading: false` whenever it is
     * disabled (which it is until the TroveManager resolves), and
     * consumers fall through to the empty-history branch and show
     * "No activity yet" during the on-chain resolution window.
     */
    isLoading:
      !isUnsupportedChain &&
      (troveManagerQuery.isLoading || operationsQuery.isLoading),
    /**
     * Surfaces the underlying TroveManager resolution error (e.g. the chain
     * is supported by the subgraph but the on-chain registry call failed).
     */
    isError: operationsQuery.isError || troveManagerQuery.isError,
    error: operationsQuery.error ?? troveManagerQuery.error,
  };
}
