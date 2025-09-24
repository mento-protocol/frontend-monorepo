"use client";
import {
  CopyToClipboard,
  LockCard,
  LockCardActions,
  LockCardAmount,
  LockCardBadge,
  LockCardBody,
  LockCardButton,
  LockCardDelegationAddress,
  LockCardDelegationLabel,
  LockCardField,
  LockCardFieldLabel,
  LockCardFieldValue,
  LockCardHeader,
  LockCardHeaderGroup,
  LockCardNotice,
  LockCardRow,
  LockCardToken,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  type BadgeType,
} from "@repo/ui";
import {
  Identicon,
  LockWithExpiration,
  useAvailableToWithdraw,
  useCurrentChain,
  useLocksByAccount,
  WalletHelper,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { subWeeks } from "date-fns";
import { Info } from "lucide-react";
import { useState, useMemo } from "react";
import { formatUnits, parseUnits } from "viem";
import { useLockedAmount, useReadContracts, useContracts } from "@repo/web3";
import { LockingABI } from "@repo/web3";
import { UpdateLockDialog } from "./update-lock-dialog";
export const LockList = () => {
  const { address } = useAccount();
  const { locks, loading, refetch } = useLocksByAccount({
    account: address as string,
  });
  const currentChain = useCurrentChain();
  const { availableToWithdraw } = useAvailableToWithdraw();

  const [selectedLock, setSelectedLock] = useState<LockWithExpiration | null>(
    null,
  );
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);

  const getBadgeType = (lock: LockWithExpiration): BadgeType => {
    const isOwner = lock.owner.id.toLowerCase() === address?.toLowerCase();
    const isDelegatedToSelf =
      lock.delegate.id.toLowerCase() === address?.toLowerCase();

    if (isOwner && isDelegatedToSelf) {
      return "personal";
    } else if (isOwner && !isDelegatedToSelf) {
      return "delegated";
    } else {
      return "received";
    }
  };

  // Helper function to format amounts
  const formatAmount = (amount: string) => {
    const formatted = formatUnits(BigInt(amount), 18);
    return Number(formatted).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
  };

  // Helper function to format date
  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Constants for calculations
  const WEEK = 7 * 24 * 60 * 60; // seconds

  // Get total locked amount from chain
  const { data: totalLockedNow = 0n } = useLockedAmount();
  const { Locking } = useContracts();

  // Get owned locks for veMENTO calculations
  const ownedLocks = useMemo(
    () =>
      (locks ?? []).filter(
        (l) => l.owner.id.toLowerCase() === address?.toLowerCase(),
      ),
    [locks, address],
  );

  // Get veMENTO amounts for owned locks using contract calls (same as voting power form)
  const { data: veMentoData } = useReadContracts({
    allowFailure: true,
    contracts: ownedLocks.map((lock) => ({
      address: Locking.address,
      abi: LockingABI,
      functionName: "getLock",
      args: [parseUnits(lock.amount, 18), lock.slope, lock.cliff],
    })),
  });

  // Map lockId to veMENTO amount from contract
  const veMentoMap = useMemo(() => {
    const map = new Map<string, bigint>();
    ownedLocks.forEach((lock, i) => {
      const result = veMentoData?.[i]?.result as [bigint, bigint] | undefined;
      if (result) {
        map.set(lock.lockId, result[0]); // First return value is veMENTO amount
      }
    });
    return map;
  }, [ownedLocks, veMentoData]);

  // Deterministic client-side estimation
  const lockEstimates = useMemo(() => {
    if (!locks || !address) return new Map();

    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);

    // Use the already computed ownedLocks from above

    // Classify locks and compute vested amounts
    const lockData = ownedLocks
      .map((lock) => {
        const amount = BigInt(lock.amount);
        const expirySec = Math.floor(lock.expiration.getTime() / 1000);
        const startSec = expirySec - lock.slope * WEEK;

        // Classify lock state
        const isExpired = nowSec >= expirySec;
        const isVesting = nowSec >= startSec && nowSec < expirySec;
        const isNotStarted = nowSec < startSec;
        const isReplaced = !!lock.replacedBy;

        // Compute vested amount (linear)
        let vestedAmount = 0n;
        if (isExpired) {
          vestedAmount = amount;
        } else if (isVesting) {
          const elapsed = BigInt(nowSec - startSec);
          const duration = BigInt(expirySec - startSec);
          vestedAmount = (amount * elapsed) / duration;
        }

        return {
          lock,
          amount,
          vestedAmount,
          isExpired,
          isVesting,
          isNotStarted,
          isReplaced,
          startSec,
          expirySec,
        };
      })
      .filter((l) => !l.isReplaced); // Ignore replaced locks

    // Step 1: Allocate available_to_withdraw to locks
    const availableTotal = availableToWithdraw ?? 0n;
    const claimableMap = new Map<string, bigint>();
    let remainingAvailable = availableTotal;

    // Expired locks first (up to their full amount)
    const expiredLocks = lockData.filter((l) => l.isExpired);
    for (const { lock, amount } of expiredLocks) {
      if (remainingAvailable <= 0n) {
        claimableMap.set(lock.lockId, 0n);
        continue;
      }
      const take = remainingAvailable < amount ? remainingAvailable : amount;
      claimableMap.set(lock.lockId, take);
      remainingAvailable -= take;
    }

    // Vesting locks pro-rata by vested amount
    const vestingLocks = lockData.filter((l) => l.isVesting);
    if (remainingAvailable > 0n && vestingLocks.length > 0) {
      const totalVested = vestingLocks.reduce(
        (sum, l) => sum + l.vestedAmount,
        0n,
      );
      if (totalVested > 0n) {
        for (const { lock, vestedAmount } of vestingLocks) {
          const allocation = (vestedAmount * remainingAvailable) / totalVested;
          claimableMap.set(
            lock.lockId,
            (claimableMap.get(lock.lockId) ?? 0n) + allocation,
          );
        }
      }
    }

    // Fix any dust to ensure exact total
    const allocatedTotal = Array.from(claimableMap.values()).reduce(
      (a, b) => a + b,
      0n,
    );
    const dust = availableTotal - allocatedTotal;
    if (dust !== 0n && lockData.length > 0) {
      const firstLock = lockData[0];
      if (firstLock) {
        const firstLockId = firstLock.lock.lockId;
        claimableMap.set(
          firstLockId,
          (claimableMap.get(firstLockId) ?? 0n) + dust,
        );
      }
    }

    // Step 2: Back-solve withdrawn amounts
    const totalOriginal = lockData.reduce((sum, l) => sum + l.amount, 0n);
    const withdrawnTotal = totalOriginal - totalLockedNow;

    const withdrawnMap = new Map<string, bigint>();
    let remainingWithdrawn = withdrawnTotal;

    // Allocate withdrawn using same logic (expired first, then vesting pro-rata)
    for (const { lock, amount } of expiredLocks) {
      if (remainingWithdrawn <= 0n) {
        withdrawnMap.set(lock.lockId, 0n);
        continue;
      }
      const take = remainingWithdrawn < amount ? remainingWithdrawn : amount;
      withdrawnMap.set(lock.lockId, take);
      remainingWithdrawn -= take;
    }

    if (remainingWithdrawn > 0n && vestingLocks.length > 0) {
      const totalVested = vestingLocks.reduce(
        (sum, l) => sum + l.vestedAmount,
        0n,
      );
      if (totalVested > 0n) {
        for (const { lock, vestedAmount } of vestingLocks) {
          const allocation = (vestedAmount * remainingWithdrawn) / totalVested;
          withdrawnMap.set(
            lock.lockId,
            (withdrawnMap.get(lock.lockId) ?? 0n) + allocation,
          );
        }
      }
    }

    // Step 3: Compute remaining amounts
    const remainingMap = new Map<string, bigint>();
    for (const { lock, amount } of lockData) {
      const withdrawn = withdrawnMap.get(lock.lockId) ?? 0n;
      const remaining = amount > withdrawn ? amount - withdrawn : 0n;
      remainingMap.set(lock.lockId, remaining);
    }

    // Ensure remaining total matches chain total
    const remainingTotal = Array.from(remainingMap.values()).reduce(
      (a, b) => a + b,
      0n,
    );
    const remainingDust = totalLockedNow - remainingTotal;
    if (remainingDust !== 0n && lockData.length > 0) {
      const firstLock = lockData[0];
      if (firstLock) {
        const firstLockId = firstLock.lock.lockId;
        remainingMap.set(
          firstLockId,
          (remainingMap.get(firstLockId) ?? 0n) + remainingDust,
        );
      }
    }

    // Return combined estimates with veMENTO calculation
    const estimates = new Map();
    for (const { lock, expirySec } of lockData) {
      const remaining = remainingMap.get(lock.lockId) ?? 0n;

      // Use contract veMENTO value if available, otherwise calculate manually
      let veMentoAmount = veMentoMap.get(lock.lockId) ?? 0n;

      // Fallback calculation if contract value not available
      if (veMentoAmount === 0n && nowSec < expirySec) {
        const timeRemaining = BigInt(expirySec - nowSec);
        const totalLockDuration = BigInt((lock.cliff + lock.slope) * WEEK);
        const MAX_LOCK_WEEKS = 104n; // 2 years maximum

        if (totalLockDuration > 0n) {
          // Calculate initial veMENTO based on lock duration (shorter locks get proportionally less)
          const lockDurationWeeks = BigInt(lock.cliff + lock.slope);
          const initialVeMento =
            (BigInt(lock.amount) * lockDurationWeeks) / MAX_LOCK_WEEKS;

          // Current veMENTO decays linearly from initial amount
          veMentoAmount = (initialVeMento * timeRemaining) / totalLockDuration;
        }
      }

      estimates.set(lock.lockId, {
        remaining: remaining,
        claimable: claimableMap.get(lock.lockId) ?? 0n,
        withdrawn: withdrawnMap.get(lock.lockId) ?? 0n,
        original: BigInt(lock.amount),
        veMento: veMentoAmount,
      });
    }

    return estimates;
  }, [locks, address, availableToWithdraw, totalLockedNow]);

  const getDelegationInfo = (
    lock: LockWithExpiration,
    badgeType: BadgeType,
  ) => {
    if (badgeType === "delegated") {
      return {
        label: "Delegated to",
        address: lock.delegate.id,
      };
    } else if (badgeType === "received") {
      return {
        label: "Received from",
        address: lock.owner.id,
      };
    }
    return null;
  };

  const handleUpdateLock = (lock: LockWithExpiration) => {
    setSelectedLock(lock);
    setIsUpdateDialogOpen(true);
  };

  const handleLockUpdated = () => {
    refetch();
    setSelectedLock(null);
    setIsUpdateDialogOpen(false);
  };

  if (!locks || locks.length === 0) {
    return <></>;
  }

  const explorerUrl = currentChain.blockExplorers?.default?.url;
  const now = new Date();

  const activeLocks = (locks ?? []).filter((l) => now < l.expiration);
  const pastLocks = (locks ?? [])
    .filter((l) => now >= l.expiration)
    .sort((a, b) => +new Date(a.expiration) - +new Date(b.expiration));

  // Calculate withdrawable amount to distribute across expired, self-owned locks
  let remaining = Number(formatUnits(availableToWithdraw ?? BigInt(0), 18));
  return (
    <div className="mt-20">
      {loading && (
        <>
          <Skeleton className="mb-5 h-10 w-60 rounded-md" />
          <div className="flex w-full flex-wrap gap-4">
            {Array.from({ length: 3 }).map(() => (
              <Skeleton className="h-64 w-full rounded-md md:max-w-[330px]" />
            ))}
          </div>
        </>
      )}
      {!loading && activeLocks.length > 0 && (
        <>
          <h2 className="mb-8 text-2xl font-medium">Your Current Locks</h2>
          <div className="flex flex-wrap gap-4">
            {activeLocks.map((lock, index) => {
              const badgeType = getBadgeType(lock);
              const delegationInfo = getDelegationInfo(lock, badgeType);

              // Get estimates for this lock
              const estimates = lockEstimates.get(lock.lockId);
              const remainingAmount =
                estimates?.remaining ?? BigInt(lock.amount);
              const claimableAmount = estimates?.claimable ?? 0n;
              const veMentoAmount = estimates?.veMento ?? 0n;
              const originalAmount = BigInt(lock.amount);

              const formattedRemaining = Number(
                formatUnits(remainingAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });
              const formattedOriginal = Number(
                formatUnits(originalAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });
              const formattedClaimable = Number(
                formatUnits(claimableAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });
              const formattedVeMento = Number(
                formatUnits(veMentoAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });

              const cliffEnd = subWeeks(lock.expiration, lock.slope);
              const hasActiveCliff = lock.cliff > 0 && new Date() < cliffEnd;
              const now = new Date();
              const inCliff = now < cliffEnd;
              const inVesting = !inCliff && now < lock.expiration;

              return (
                <LockCard
                  key={lock.lockId}
                  id={`lock-${lock.lockId}`}
                  data-testid={`lockCard_${index}`}
                >
                  <LockCardHeader>
                    <LockCardHeaderGroup>
                      <LockCardAmount>{formattedRemaining}</LockCardAmount>
                      <LockCardToken>MENTO</LockCardToken>
                    </LockCardHeaderGroup>
                    <LockCardBadge
                      type={badgeType}
                      data-testid={`lockCardBadge`}
                    >
                      {badgeType.charAt(0).toUpperCase() + badgeType.slice(1)}
                    </LockCardBadge>
                  </LockCardHeader>
                  <LockCardBody>
                    {delegationInfo && (
                      <LockCardRow>
                        <LockCardField>
                          <LockCardDelegationLabel>
                            {delegationInfo.label}
                          </LockCardDelegationLabel>
                          <LockCardDelegationAddress>
                            <div className="flex items-center gap-2">
                              <Identicon
                                address={delegationInfo.address}
                                size={16}
                              />
                              <a
                                className="text-muted-foreground text-sm"
                                href={`${explorerUrl}/address/${delegationInfo.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {WalletHelper.getShortAddress(
                                  delegationInfo.address,
                                )}
                              </a>
                              <CopyToClipboard text={delegationInfo.address} />
                            </div>
                          </LockCardDelegationAddress>
                        </LockCardField>
                      </LockCardRow>
                    )}

                    <LockCardRow>
                      <LockCardField>
                        <LockCardFieldLabel>
                          Originally locked
                        </LockCardFieldLabel>
                        <LockCardFieldValue>
                          {formattedOriginal}{" "}
                          <span className="text-muted-foreground">MENTO</span>
                        </LockCardFieldValue>
                      </LockCardField>
                      {veMentoAmount > 0n && (
                        <LockCardField>
                          <LockCardFieldLabel>
                            Current veMENTO
                          </LockCardFieldLabel>
                          <LockCardFieldValue>
                            {formattedVeMento}{" "}
                            <span className="text-muted-foreground">
                              veMENTO
                            </span>
                          </LockCardFieldValue>
                        </LockCardField>
                      )}
                      <LockCardField>
                        <LockCardFieldLabel>Expires</LockCardFieldLabel>
                        <LockCardFieldValue className="flex items-center gap-1">
                          {formatDate(lock.expiration)}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="text-muted-foreground ml-1 size-4" />
                              </TooltipTrigger>
                              <TooltipContent>
                                {inCliff ? (
                                  <p>Cliff until {formatDate(cliffEnd)}</p>
                                ) : inVesting ? (
                                  <p>Vesting since {formatDate(cliffEnd)}</p>
                                ) : (
                                  <p>Expired</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </LockCardFieldValue>
                      </LockCardField>
                      {claimableAmount > 0n && (
                        <LockCardField>
                          <LockCardFieldLabel>
                            Withdrawable now
                          </LockCardFieldLabel>
                          <LockCardFieldValue>
                            {formattedClaimable}{" "}
                            <span className="text-muted-foreground">MENTO</span>
                          </LockCardFieldValue>
                        </LockCardField>
                      )}
                    </LockCardRow>
                  </LockCardBody>

                  {badgeType !== "received" && (
                    <LockCardActions>
                      <LockCardButton
                        onClick={() => handleUpdateLock(lock)}
                        data-testid={`updateLockButton`}
                      >
                        Update
                      </LockCardButton>
                    </LockCardActions>
                  )}

                  {badgeType === "received" && (
                    <LockCardNotice>
                      Only the{" "}
                      <a
                        href={`${explorerUrl}/address/${lock.owner.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold"
                      >
                        lock owner
                      </a>{" "}
                      can update delegated locks
                    </LockCardNotice>
                  )}
                </LockCard>
              );
            })}
          </div>
        </>
      )}

      {pastLocks.length > 0 && (
        <>
          <h2 className="my-8 mt-12 text-2xl font-medium">Your Past Locks</h2>
          <div className="flex gap-4 sm:flex-wrap">
            {pastLocks.map((lock) => {
              const badgeType = getBadgeType(lock);
              const delegationInfo = getDelegationInfo(lock, badgeType);
              const isOwner =
                lock.owner.id.toLowerCase() === address?.toLowerCase();

              // Get estimates for this lock
              const estimates = lockEstimates.get(lock.lockId);
              const remainingAmount =
                estimates?.remaining ?? BigInt(lock.amount);
              const claimableAmount = estimates?.claimable ?? 0n;
              const veMentoAmount = estimates?.veMento ?? 0n;
              const originalAmount = BigInt(lock.amount);

              const formattedRemaining = Number(
                formatUnits(remainingAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });
              const formattedOriginal = Number(
                formatUnits(originalAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });
              const formattedClaimable = Number(
                formatUnits(claimableAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });
              const formattedVeMento = Number(
                formatUnits(veMentoAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });

              const expired = lock.expiration < new Date();

              return (
                <LockCard key={lock.lockId} id={`lock-${lock.lockId}`}>
                  <LockCardHeader>
                    <LockCardHeaderGroup>
                      <LockCardAmount>≈{formattedRemaining}</LockCardAmount>
                      <LockCardToken>MENTO</LockCardToken>
                    </LockCardHeaderGroup>
                    <LockCardBadge type={expired ? "expired" : "unlocked"}>
                      {expired ? "Expired" : "Unlocked"}
                    </LockCardBadge>
                  </LockCardHeader>
                  <LockCardBody>
                    {delegationInfo && (
                      <LockCardRow>
                        <LockCardField>
                          <LockCardDelegationLabel>
                            {delegationInfo.label}
                          </LockCardDelegationLabel>
                          <LockCardDelegationAddress>
                            <div className="flex items-center gap-2">
                              <Identicon
                                address={delegationInfo.address}
                                size={16}
                              />
                              <a
                                className="text-muted-foreground text-sm"
                                href={`${explorerUrl}/address/${delegationInfo.address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {WalletHelper.getShortAddress(
                                  delegationInfo.address,
                                )}
                              </a>
                              <CopyToClipboard text={delegationInfo.address} />
                            </div>
                          </LockCardDelegationAddress>
                        </LockCardField>
                      </LockCardRow>
                    )}

                    <LockCardRow>
                      <LockCardField>
                        <LockCardFieldLabel>
                          Originally locked
                        </LockCardFieldLabel>
                        <LockCardFieldValue>
                          {formattedOriginal}{" "}
                          <span className="text-muted-foreground">MENTO</span>
                        </LockCardFieldValue>
                      </LockCardField>
                      {claimableAmount > 0n && (
                        <LockCardField>
                          <LockCardFieldLabel>
                            Withdrawable now
                          </LockCardFieldLabel>
                          <LockCardFieldValue>
                            {formattedClaimable}{" "}
                            <span className="text-muted-foreground">MENTO</span>
                          </LockCardFieldValue>
                        </LockCardField>
                      )}
                    </LockCardRow>

                    <LockCardRow>
                      <LockCardField>
                        <LockCardFieldLabel>
                          {expired ? "Expired" : "Expires"}
                        </LockCardFieldLabel>
                        <LockCardFieldValue>
                          {formatDate(lock.expiration)}
                        </LockCardFieldValue>
                      </LockCardField>
                    </LockCardRow>
                  </LockCardBody>
                </LockCard>
              );
            })}
          </div>
        </>
      )}

      {selectedLock && (
        <UpdateLockDialog
          open={isUpdateDialogOpen}
          onOpenChange={setIsUpdateDialogOpen}
          lock={selectedLock}
          onLockUpdated={handleLockUpdated}
        />
      )}
    </div>
  );
};
