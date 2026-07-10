import { getSubgraphApiName } from "@/config";
import { LockWithExpiration } from "@/contracts/types";
import {
  GetLocksQueryResult,
  useGetLocksQuery,
} from "@/graphql/subgraph/generated/subgraph";
import { reportSubgraphError } from "@/utils/report-subgraph-error";
import { useEnsureChainId } from "@repo/web3";
import { useEffect, useMemo } from "react";
import LockingHelper from "./locking-helper";
import { useLockingWeek } from "./use-locking-week";

interface UseLocksProps {
  account: string | undefined;
}

export const useLocksByAccount = ({
  account,
}: UseLocksProps): Omit<GetLocksQueryResult, "data"> & {
  locks: LockWithExpiration[];
} => {
  const { currentWeek: currentLockingWeek } = useLockingWeek();
  const ensuredChainId = useEnsureChainId();

  const { data, error, ...rest } = useGetLocksQuery({
    refetchWritePolicy: "overwrite",
    fetchPolicy: "network-only",
    errorPolicy: "all",
    skip: !account,
    variables: {
      address: account ?? "",
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

    reportSubgraphError(error, "GetLocks");
  }, [error]);

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

  return {
    locks,
    error,
    ...rest,
  };
};
