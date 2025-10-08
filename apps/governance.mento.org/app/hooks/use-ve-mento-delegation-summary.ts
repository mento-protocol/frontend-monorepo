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
      let veMentoAmount = 0n;

      if (nowSecBig < expirySecBig) {
        const secsRemaining = expirySecBig - nowSecBig;
        const weeksRemaining = (secsRemaining + WEEK_BIG - 1n) / WEEK_BIG;
        const amountForVe = BigInt(lock.amount);
        veMentoAmount = (amountForVe * weeksRemaining) / MAX_LOCK_WEEKS;
      }

      map.set(lock.lockId, veMentoAmount);
    }
    return map;
  }, [activeLocks, WEEK_BIG, MAX_LOCK_WEEKS]);

  // Totals
  const { delegatedOutVe, receivedVe } = useMemo(() => {
    let delegatedOut = 0;
    let received = 0;

    for (const l of activeLocks) {
      const ve = veByLockId.get(l.lockId) ?? 0n;
      const veNum = Number(formatUnits(ve, 18));

      const ownerIsMe = !!addressLc && l.owner.id.toLowerCase() === addressLc;
      const delegateIsMe =
        !!addressLc && l.delegate.id.toLowerCase() === addressLc;

      if (ownerIsMe && !delegateIsMe) {
        delegatedOut += veNum;
      } else if (!ownerIsMe && delegateIsMe) {
        received += veNum;
      }
    }

    return { delegatedOutVe: delegatedOut, receivedVe: received };
  }, [activeLocks, veByLockId, addressLc]);

  return {
    delegatedOutVe,
    receivedVe,
    veByLockId,
  };
}
