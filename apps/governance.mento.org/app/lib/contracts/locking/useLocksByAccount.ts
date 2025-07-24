import { getSubgraphApiName } from "@/lib/config/config.constants";
import {
  useGetLocksQuery,
  GetLocksQueryResult,
} from "@/lib/graphql/subgraph/generated/subgraph";
import LockingHelper from "@/lib/helpers/locking";
import { useEnsureChainId } from "@/lib/hooks/use-ensure-chain-id";
import useLockingWeek from "./useLockingWeek";
import { useMemo } from "react";
import { LockWithExpiration } from "@/lib/interfaces/lock.interface";
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
