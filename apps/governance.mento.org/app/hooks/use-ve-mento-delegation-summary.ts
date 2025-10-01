import { useMemo } from "react";
import { formatUnits } from "viem";
import { LockWithExpiration } from "@repo/web3";

export function useVeMentoDelegationSummary(params: {
  locks: LockWithExpiration[] | undefined;
  address?: string;
}) {
  const { locks, address } = params;

  const now = new Date();
  const isMe = (a: string) =>
    !!address && a.toLowerCase() === address.toLowerCase();

  // Only consider active locks and exclude replaced locks
  const activeLocks = useMemo(
    () => (locks ?? []).filter((l) => now < l.expiration && !l.replacedBy),
    [locks, now],
  );

  // Deterministic estimation matching lock-list.tsx
  const WEEK = 7 * 24 * 60 * 60;
  const WEEK_BIG = BigInt(WEEK);
  const MAX_LOCK_WEEKS = 104n;
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

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
        const weeksRemaining = ceilDiv(secsRemaining, WEEK_BIG);
        const amountForVe = BigInt(lock.amount);
        veMentoAmount = (amountForVe * weeksRemaining) / MAX_LOCK_WEEKS;
      }

      map.set(lock.lockId, veMentoAmount);
    }
    return map;
  }, [activeLocks]);

  // Totals
  const { delegatedOutVe, receivedVe } = useMemo(() => {
    let delegatedOut = 0;
    let received = 0;

    for (const l of activeLocks) {
      const ve = veByLockId.get(l.lockId) ?? 0n;
      const veNum = Number(formatUnits(ve, 18));

      if (isMe(l.owner.id) && !isMe(l.delegate.id)) {
        delegatedOut += veNum;
      } else if (!isMe(l.owner.id) && isMe(l.delegate.id)) {
        received += veNum;
      }
    }

    return { delegatedOutVe: delegatedOut, receivedVe: received };
  }, [activeLocks, veByLockId, address]);

  return {
    delegatedOutVe,
    receivedVe,
    veByLockId,
  };
}
