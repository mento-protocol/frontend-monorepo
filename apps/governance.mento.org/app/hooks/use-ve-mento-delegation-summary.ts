import { LockWithExpiration } from "@/contracts/types";
import { useMemo } from "react";
import { formatUnits } from "viem";

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
 * Calculates delegation totals by categorizing locks based on ownership and delegation.
 * Returns veMENTO amounts for:
 * - delegatedOut: Locks owned by user but delegated to others
 * - received: Locks owned by others but delegated to user
 * - own: Locks owned and delegated to user themselves
 */
function calculateDelegationTotals(
  activeLocks: LockWithExpiration[],
  veByLockId: Map<string, bigint>,
  userAddress: string | undefined,
): { delegatedOutVe: number; receivedVe: number; ownVe: number } {
  let delegatedOut = 0;
  let received = 0;
  let own = 0;

  const addressLc = userAddress?.toLowerCase();

  for (const lock of activeLocks) {
    const ve = veByLockId.get(lock.lockId) ?? 0n;
    const veNum = Number(formatUnits(ve, 18));

    const ownerIsMe = !!addressLc && lock.owner.id.toLowerCase() === addressLc;
    const delegateIsMe =
      !!addressLc && lock.delegate.id.toLowerCase() === addressLc;

    if (ownerIsMe && !delegateIsMe) {
      // I own this lock but delegated it to someone else
      delegatedOut += veNum;
    } else if (!ownerIsMe && delegateIsMe) {
      // Someone else owns this lock but delegated it to me
      received += veNum;
    } else if (ownerIsMe && delegateIsMe) {
      // I own this lock and it's delegated to myself
      own += veNum;
    }
  }

  return { delegatedOutVe: delegatedOut, receivedVe: received, ownVe: own };
}

export function useVeMentoDelegationSummary(params: {
  locks: LockWithExpiration[] | undefined;
  address?: string;
}) {
  const { locks, address } = params;

  // Only consider active locks and exclude replaced locks
  const activeLocks = useMemo(() => {
    const nowMs = Date.now();
    return (locks ?? []).filter(
      (l) => nowMs < l.expiration.getTime() && !l.replacedBy,
    );
  }, [locks]);

  // Deterministic estimation matching lock-list.tsx
  const WEEK = 7 * 24 * 60 * 60;
  const WEEK_BIG = BigInt(WEEK);
  const MAX_LOCK_WEEKS = 104n;

  // Map lockId -> current estimated veMENTO
  const veByLockId = useMemo(() => {
    const map = new Map<string, bigint>();
    const nowSec = Math.floor(new Date().getTime() / 1000);
    const nowSecBig = BigInt(nowSec);

    for (const lock of activeLocks) {
      const veMentoAmount = calculateVeMentoForLock(
        lock,
        nowSecBig,
        WEEK_BIG,
        MAX_LOCK_WEEKS,
      );
      map.set(lock.lockId, veMentoAmount);
    }
    return map;
  }, [activeLocks, WEEK_BIG, MAX_LOCK_WEEKS]);

  // Totals
  const { delegatedOutVe, receivedVe, ownVe } = useMemo(
    () => calculateDelegationTotals(activeLocks, veByLockId, address),
    [activeLocks, veByLockId, address],
  );

  return {
    delegatedOutVe,
    receivedVe,
    ownVe,
    veByLockId,
  };
}
