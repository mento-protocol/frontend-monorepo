import { LockWithExpiration } from "@/contracts/types";
import { useMemo } from "react";
import { formatUnits } from "viem";

export function useVeMentoDelegationSummary(params: {
  locks: LockWithExpiration[] | undefined;
  address?: string;
}) {
  const { locks, address } = params;

  const addressLc = address?.toLowerCase();

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
      const expirySec = Math.floor(lock.expiration.getTime() / 1000);
      const expirySecBig = BigInt(expirySec);
      const startSec = Math.floor(
        expirySec - (lock.cliff + lock.slope) * Number(WEEK_BIG),
      );
      const startSecBig = BigInt(startSec);
      // Cliff ends when vesting begins
      const cliffEndSec = startSec + lock.cliff * Number(WEEK_BIG);
      const cliffEndSecBig = BigInt(cliffEndSec);
      let veMentoAmount = 0n;

      if (nowSecBig < expirySecBig) {
        const amountForVe = BigInt(lock.amount);

        // During cliff period: veMENTO remains at full value
        if (nowSecBig < cliffEndSecBig) {
          // Calculate total weeks (cliff + slope)
          const totalWeeks = BigInt(lock.cliff + lock.slope);
          veMentoAmount = (amountForVe * totalWeeks) / MAX_LOCK_WEEKS;
        } else {
          // During slope period: veMENTO decays linearly
          const secsRemaining = expirySecBig - nowSecBig;
          const weeksRemaining = (secsRemaining + WEEK_BIG - 1n) / WEEK_BIG;
          veMentoAmount = (amountForVe * weeksRemaining) / MAX_LOCK_WEEKS;
        }
      }

      map.set(lock.lockId, veMentoAmount);
    }
    return map;
  }, [activeLocks, WEEK_BIG, MAX_LOCK_WEEKS]);

  // Totals
  const { delegatedOutVe, receivedVe, ownVe } = useMemo(() => {
    let delegatedOut = 0;
    let received = 0;
    let own = 0;

    for (const l of activeLocks) {
      const ve = veByLockId.get(l.lockId) ?? 0n;
      const veNum = Number(formatUnits(ve, 18));

      const ownerIsMe = !!addressLc && l.owner.id.toLowerCase() === addressLc;
      const delegateIsMe =
        !!addressLc && l.delegate.id.toLowerCase() === addressLc;

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
  }, [activeLocks, veByLockId, addressLc]);

  return {
    delegatedOutVe,
    receivedVe,
    ownVe,
    veByLockId,
  };
}
