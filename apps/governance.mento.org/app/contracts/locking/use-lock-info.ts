import { useUnlockedMento } from "./use-unlocked-mento";
import { useLocksByAccount } from "./use-locks-by-account";
import { useLockedAmount } from "./use-locked-amount";
import React from "react";
import { useLockingWeek } from "./use-locking-week";
import { formatUnits } from "viem";
import { useTokens } from "@/governance/use-tokens";

const formatNumber = (value: bigint | undefined, decimals: number): string =>
  Number(formatUnits(value ?? BigInt(0), decimals)).toFixed(3);

export const useLockInfo = (address: string | undefined) => {
  const { locks, refetch } = useLocksByAccount({ account: address! });

  const { data: unlockedMento, isLoading: isUnlockedMentoLoading } =
    useUnlockedMento();
  const { mentoContractData, veMentoContractData, isBalanceLoading } =
    useTokens();
  const { data: lockedBalance, isLoading: isLockedAmountLoading } =
    useLockedAmount();
  const { currentWeek: currentLockingWeek, isLoading: isCurrentWeekLoading } =
    useLockingWeek();

  const activeLocks = React.useMemo(() => {
    if (!locks) {
      return [];
    }
    return locks
      .filter((lock) => {
        return lock.expiration > new Date();
      })
      .sort((a, b) => {
        return Number(a.lockId) < Number(b.lockId) ? 1 : -1;
      });
  }, [locks]);

  const lock = activeLocks[0];
  const hasMultipleLocks = React.useMemo(() => {
    return activeLocks.length > 1;
  }, [activeLocks]);

  const isLockExtendible = React.useMemo(() => {
    if (
      !currentLockingWeek ||
      isNaN(lock?.slope ?? 0) ||
      isNaN(lock?.cliff ?? 0) ||
      isNaN(lock?.time ?? 0)
    ) {
      return false;
    }
    const weeksPassed = Number(currentLockingWeek) - lock?.time;
    return weeksPassed > 1;
  }, [currentLockingWeek, lock?.cliff, lock?.slope, lock?.time]);

  return {
    isLockExtendible,
    isLoading:
      isCurrentWeekLoading ||
      isUnlockedMentoLoading ||
      isBalanceLoading ||
      isLockedAmountLoading,
    unlockedMento: formatNumber(unlockedMento, mentoContractData.decimals),
    lockedBalance: formatNumber(lockedBalance, veMentoContractData.decimals),
    hasLock: locks.length > 0,
    hasActiveLock: activeLocks.length > 0,
    activeLocks,
    hasMultipleLocks,
    allLocks: locks,
    lock,
    refetch,
  };
};
