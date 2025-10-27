import { getSubgraphApiName } from "@/config";
import { useOptimisticLocks } from "@/contexts/optimistic-locks-context";
import { LockWithExpiration } from "@/contracts/types";
import {
  GetLocksQueryResult,
  useGetLocksQuery,
} from "@/graphql/subgraph/generated/subgraph";
import { useEnsureChainId } from "@repo/web3";
import { useMemo } from "react";
import LockingHelper from "./locking-helper";
import { useLockingWeek } from "./use-locking-week";

interface UseLocksProps {
  account: string;
}

export const useLocksByAccount = ({
  account,
}: UseLocksProps): Omit<GetLocksQueryResult, "data"> & {
  locks: LockWithExpiration[];
} => {
  const { currentWeek: currentLockingWeek } = useLockingWeek();
  const ensuredChainId = useEnsureChainId();
  const { optimisticLocks, removeOptimisticLock } = useOptimisticLocks();

  const { data, ...rest } = useGetLocksQuery({
    refetchWritePolicy: "overwrite",
    fetchPolicy: "network-only",
    errorPolicy: "ignore",
    variables: {
      address: account,
    },
    context: {
      apiName: getSubgraphApiName(ensuredChainId),
    },
    ssr: false,
  });

  const locks = useMemo(() => {
    if (!data) {
      return [] as LockWithExpiration[];
    }

    // Build a set of lockIds that were replaced by a newer lock
    const replacedIds = new Set<string>();
    for (const l of data.locks) {
      const replaced = l?.replaces?.lockId;
      if (replaced !== undefined && replaced !== null) {
        replacedIds.add(String(replaced));
      }
    }

    // Keep only active/latest locks: exclude items that have a replacedBy pointer
    // OR are referenced in another lock's `replaces`
    const activeLocks = data.locks.filter(
      (l) => !l.replacedBy && !replacedIds.has(String(l.lockId)),
    );

    const mapped = activeLocks.map((lock) => ({
      ...lock,
      expiration: LockingHelper.calculateExpirationDate(
        Number(currentLockingWeek),
        lock.time,
        lock.slope,
        lock.cliff,
      ),
    })) as LockWithExpiration[];

    // Sort newest first by lockId (desc)
    mapped.sort((a, b) => Number(b.lockId) - Number(a.lockId));

    return mapped;
  }, [data, currentLockingWeek]) as LockWithExpiration[];

  // Merge optimistic locks with real locks
  const mergedLocks = useMemo(() => {
    // Filter optimistic locks for this account
    const accountOptimisticLocks = optimisticLocks.filter(
      (lock) => lock.owner.id.toLowerCase() === account.toLowerCase(),
    );

    // Remove optimistic locks that now exist in real data
    const realLockIds = new Set(locks.map((l) => String(l.lockId)));
    accountOptimisticLocks.forEach((optLock) => {
      if (realLockIds.has(String(optLock.lockId))) {
        removeOptimisticLock(String(optLock.lockId));
      }
    });

    // Filter out optimistic locks that are now real
    const validOptimisticLocks = accountOptimisticLocks.filter(
      (optLock) => !realLockIds.has(String(optLock.lockId)),
    );

    // Combine and sort: optimistic locks first (newest), then real locks
    return [...validOptimisticLocks, ...locks];
  }, [locks, optimisticLocks, account, removeOptimisticLock]);

  return {
    locks: mergedLocks,
    ...rest,
  };
};
