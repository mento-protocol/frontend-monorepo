import { getSubgraphApiName } from "@/config";
import { useEnsureChainId } from "@/features/governance/use-ensure-chain-id";
import {
  GetLocksQueryResult,
  useGetLocksQuery,
} from "@/graphql/subgraph/generated/subgraph";
import { LockWithExpiration } from "@/types";
import LockingHelper from "@/utils/locking";
import { useMemo } from "react";
import useLockingWeek from "./use-locking-week";

interface UseLocksProps {
  account: string;
}

const useLocksByAccount = ({
  account,
}: UseLocksProps): Omit<GetLocksQueryResult, "data"> & {
  locks: LockWithExpiration[];
} => {
  const { currentWeek: currentLockingWeek } = useLockingWeek();
  const ensuredChainId = useEnsureChainId();
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
      return [];
    }
    return data?.locks.map((lock) => ({
      ...lock,
      expiration: LockingHelper.calculateExpirationDate(
        Number(currentLockingWeek),
        lock.time,
        lock.slope,
        lock.cliff,
      ),
    }));
  }, [data, currentLockingWeek]) as LockWithExpiration[];

  return {
    locks,
    ...rest,
  };
};

export default useLocksByAccount;
