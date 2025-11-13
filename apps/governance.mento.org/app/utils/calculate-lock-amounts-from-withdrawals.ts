import { LockWithExpiration } from "@/contracts/types";
import { GetWithdrawalsQuery } from "@/graphql/subgraph/generated/subgraph";
import { type LockAmounts } from "@/types/lock-amounts";

type WithdrawalEvent = GetWithdrawalsQuery["withdraws"][number];

/**
 * Calculates the current veMENTO amount for a given lock based on its cliff and slope periods.
 * During the cliff period, veMENTO remains at full value.
 * During the slope period, veMENTO decays linearly until expiration.
 */
function calculateVeMentoForLock(
  lock: LockWithExpiration,
  nowSecBig: bigint,
  weekBig: bigint,
  maxLockWeeks: bigint,
): bigint {
  const expirySec = Math.floor(lock.expiration.getTime() / 1000);
  const expirySecBig = BigInt(expirySec);
  const startSec = Math.floor(
    expirySec - (lock.cliff + lock.slope) * Number(weekBig),
  );
  // Cliff ends when vesting begins
  const cliffEndSec = startSec + lock.cliff * Number(weekBig);
  const cliffEndSecBig = BigInt(cliffEndSec);

  // Lock has expired
  if (nowSecBig >= expirySecBig) {
    return 0n;
  }

  const amountForVe = BigInt(lock.amount);

  // During cliff period: veMENTO remains at full value
  if (nowSecBig < cliffEndSecBig) {
    // Calculate total weeks (cliff + slope)
    const totalWeeks = BigInt(lock.cliff + lock.slope);
    return (amountForVe * totalWeeks) / maxLockWeeks;
  }

  // During slope period: veMENTO decays linearly
  const secsRemaining = expirySecBig - nowSecBig;
  const weeksRemaining = (secsRemaining + weekBig - 1n) / weekBig;
  return (amountForVe * weeksRemaining) / maxLockWeeks;
}

/**
 * Calculates the exact remaining MENTO and current veMENTO amounts for all locks
 * by using withdrawal events from the subgraph.
 *
 * Strategy:
 * 1. Find the most recent withdrawal event for the account
 * 2. Determine which locks existed at that withdrawal timestamp
 * 3. Calculate how much was withdrawn from each lock proportionally
 * 4. Calculate remaining MENTO and current veMENTO for each lock
 *
 * @param locks - Array of locks with expiration dates
 * @param withdrawals - Array of withdrawal events from the subgraph
 * @param address - The account address
 * @returns Array of lock amounts with remaining MENTO and veMENTO
 */
export function calculateLockAmountsFromWithdrawals(
  locks: LockWithExpiration[],
  withdrawals: WithdrawalEvent[],
  address: string | undefined,
): LockAmounts[] {
  if (!locks || locks.length === 0 || !address) {
    return [];
  }

  const WEEK = 7 * 24 * 60 * 60;
  const WEEK_BIG = BigInt(WEEK);
  const MAX_LOCK_WEEKS = 104n;

  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const nowSecBig = BigInt(nowSec);

  // Filter to only owned locks (not delegated from others)
  const ownedLocks = locks.filter(
    (lock) => lock.owner.id.toLowerCase() === address.toLowerCase(),
  );

  if (ownedLocks.length === 0) {
    return [];
  }

  // Find the most recent withdrawal event
  const lastWithdrawal =
    withdrawals.length > 0
      ? withdrawals.reduce((latest, current) =>
          Number(current.timestamp) > Number(latest.timestamp)
            ? current
            : latest,
        )
      : null;

  // If no withdrawals, all locks have their full original amounts
  if (!lastWithdrawal) {
    const results: LockAmounts[] = [];
    for (const lock of ownedLocks) {
      const originalAmount = BigInt(lock.amount);
      const lockForVeCalculation = {
        ...lock,
        amount: originalAmount.toString(),
      };
      const currentVeMento = calculateVeMentoForLock(
        lockForVeCalculation,
        nowSecBig,
        WEEK_BIG,
        MAX_LOCK_WEEKS,
      );
      results.push({
        lockId: lock.lockId,
        remainingMento: originalAmount,
        currentVeMento,
        originalAmount,
        withdrawn: 0n,
      });
    }
    return results;
  }

  const lastWithdrawalTimestamp = Number(lastWithdrawal.timestamp);

  // Calculate how much was withdrawn from each lock based on the last withdrawal
  const withdrawnMap = new Map<string, bigint>();

  for (const lock of ownedLocks) {
    const lockCreateTimestamp = lock.lockCreate?.[0]?.timestamp
      ? Number(lock.lockCreate[0].timestamp)
      : 0;

    // If lock was created after the last withdrawal, it's unaffected
    if (lockCreateTimestamp > lastWithdrawalTimestamp) {
      withdrawnMap.set(lock.lockId, 0n);
      continue;
    }

    // Calculate how much was vested at the time of last withdrawal
    const expirySec = Math.floor(lock.expiration.getTime() / 1000);
    const lockStartSec = Math.floor(
      expirySec - (lock.cliff + lock.slope) * Number(WEEK_BIG),
    );
    const vestingStartSec = lockStartSec + lock.cliff * Number(WEEK_BIG);

    const isExpired = lastWithdrawalTimestamp >= expirySec;
    const isVesting =
      lastWithdrawalTimestamp >= vestingStartSec &&
      lastWithdrawalTimestamp < expirySec;

    let vestedAmount = 0n;
    const lockAmount = BigInt(lock.amount);

    if (isExpired) {
      // Lock was fully vested at withdrawal time - all withdrawn
      vestedAmount = lockAmount;
    } else if (isVesting) {
      // Lock was partially vested - calculate vested amount
      const weeksPassed = Math.min(
        Math.floor((lastWithdrawalTimestamp - vestingStartSec) / WEEK),
        Number(lock.slope),
      );
      vestedAmount = (lockAmount * BigInt(weeksPassed)) / BigInt(lock.slope);
    }
    // else: lock was in cliff period - nothing vested yet

    withdrawnMap.set(lock.lockId, vestedAmount);
  }

  // Calculate current veMENTO for each lock and build result
  const results: LockAmounts[] = [];

  for (const lock of ownedLocks) {
    const originalAmount = BigInt(lock.amount);
    const withdrawn = withdrawnMap.get(lock.lockId) ?? 0n;
    const remainingMento =
      originalAmount > withdrawn ? originalAmount - withdrawn : 0n;

    // veMENTO is always based on the ORIGINAL amount, not remaining amount
    // Withdrawals don't reduce veMENTO - only time decay does
    const currentVeMento = calculateVeMentoForLock(
      lock,
      nowSecBig,
      WEEK_BIG,
      MAX_LOCK_WEEKS,
    );

    results.push({
      lockId: lock.lockId,
      remainingMento,
      currentVeMento,
      originalAmount,
      withdrawn,
    });
  }

  return results;
}
