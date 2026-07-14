import { getSubgraphApiName } from "@/config";
import { LockWithExpiration } from "@/contracts/types";
import {
  GetWithdrawalsDocument,
  GetWithdrawalsQuery,
  GetWithdrawalsQueryVariables,
} from "@/graphql/subgraph/generated/subgraph";
import { useQuery } from "@apollo/client/react";
import { LockAmounts } from "@/types/lock-amounts";
import { reportSubgraphError } from "@/utils/report-subgraph-error";
import { calculateLockAmountsFromWithdrawals } from "@/utils/calculate-lock-amounts-from-withdrawals";
import { useEnsureChainId } from "@repo/web3";
import { useEffect, useMemo } from "react";

interface UseLockAmountsFromWithdrawalsParams {
  locks: LockWithExpiration[] | undefined;
  address: string | undefined;
}

interface UseLockAmountsFromWithdrawalsResult {
  lockAmounts: LockAmounts[];
  lockAmountsMap: Map<string, LockAmounts>;
  loading: boolean;
  error?: Error;
}

/**
 * Hook that calculates exact remaining MENTO and current veMENTO amounts for all locks
 * by using withdrawal events from the subgraph.
 *
 * This provides accurate per-lock amounts by:
 * 1. Fetching all withdrawal events for the account
 * 2. Determining which locks existed at each withdrawal
 * 3. Allocating withdrawn amounts proportionally based on vested amounts
 * 4. Calculating current veMENTO based on remaining MENTO
 *
 * @param locks - Array of locks with expiration dates
 * @param address - The account address
 * @returns Object containing lock amounts array, map, and loading state
 */
export function useLockAmountsFromWithdrawals({
  locks,
  address,
}: UseLockAmountsFromWithdrawalsParams): UseLockAmountsFromWithdrawalsResult {
  const ensuredChainId = useEnsureChainId();

  // Fetch withdrawal events for the account
  const { data, loading, error } = useQuery<
    GetWithdrawalsQuery,
    GetWithdrawalsQueryVariables
  >(GetWithdrawalsDocument, {
    skip: !address,
    fetchPolicy: "network-only",
    errorPolicy: "all",
    variables: {
      address: address ?? "",
    },
    context: {
      apiName: getSubgraphApiName(ensuredChainId),
    },
    ssr: false,
  });

  useEffect(() => {
    if (!error) {
      return;
    }

    reportSubgraphError(error, "GetWithdrawals");
  }, [error]);

  // Calculate lock amounts using withdrawal events
  const lockAmounts = useMemo(() => {
    if (!locks || !address || !data?.withdraws) {
      return [];
    }

    return calculateLockAmountsFromWithdrawals(locks, data.withdraws, address);
  }, [locks, address, data?.withdraws]);

  // Create a map for easy lookup by lockId
  const lockAmountsMap = useMemo(() => {
    const map = new Map<string, LockAmounts>();
    for (const lockAmount of lockAmounts) {
      map.set(lockAmount.lockId, lockAmount);
    }
    return map;
  }, [lockAmounts]);

  return {
    lockAmounts,
    lockAmountsMap,
    loading,
    error: error ?? undefined,
  };
}
