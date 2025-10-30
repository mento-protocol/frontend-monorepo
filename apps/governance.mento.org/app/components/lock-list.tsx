"use client";
import { useLocksByAccount } from "@/contracts";
import { LockWithExpiration } from "@/contracts/types";
import { useLockAmountsFromWithdrawals } from "@/hooks/use-lock-amounts-from-withdrawals";
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
import { Identicon, useBlock, useCurrentChain, WalletHelper } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { subWeeks } from "date-fns";
import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { UpdateLockDialog } from "./update-lock-dialog";

export const LockList = () => {
  const { address } = useAccount();
  const { locks, loading, refetch } = useLocksByAccount({
    account: address as string,
  });

  const block = useBlock();
  const currentChain = useCurrentChain();

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
    }
    if (isOwner && !isDelegatedToSelf) {
      return "delegated";
    }
    return "received";
  };

  // Helper function to format date
  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Calculate exact amounts using withdrawal events from subgraph
  const { lockAmountsMap, loading: amountsLoading } =
    useLockAmountsFromWithdrawals({
      locks,
      address,
    });

  // Get received locks (delegated to current user) for display
  const receivedLocks = useMemo(
    () =>
      locks?.length
        ? locks.filter(
            (l) =>
              l.owner.id.toLowerCase() !== address?.toLowerCase() &&
              l.delegate.id.toLowerCase() === address?.toLowerCase() &&
              !l.replacedBy,
          )
        : [],
    [locks, address],
  );

  // Build estimates map from withdrawal-based calculations
  const lockEstimates = useMemo(() => {
    const estimates = new Map();

    // Add owned locks with accurate amounts from withdrawal events
    for (const [lockId, amounts] of lockAmountsMap.entries()) {
      estimates.set(lockId, {
        remaining: amounts.remainingMento,
        withdrawn: amounts.withdrawn,
        original: amounts.originalAmount,
        veMento: amounts.currentVeMento,
      });
    }

    // Add received locks (delegated to current user)
    // For received locks, show original amount since we can't track owner's withdrawals
    for (const lock of receivedLocks) {
      const receivedRemaining = BigInt(lock.amount);
      estimates.set(lock.lockId, {
        remaining: receivedRemaining,
        withdrawn: 0n,
        original: BigInt(lock.amount),
        veMento: lockAmountsMap.get(lock.lockId)?.currentVeMento ?? 0n,
      });
    }

    return estimates;
  }, [lockAmountsMap, receivedLocks]);

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

  const activeLocks = (locks ?? []).filter(
    (l) => now < l.expiration && !l.replacedBy,
  );
  const pastLocks = (locks ?? [])
    .filter((l) => now >= l.expiration && !l.replacedBy)
    .sort((a, b) => +new Date(a.expiration) - +new Date(b.expiration));

  return (
    <div className="mt-20">
      {(loading || amountsLoading) && (
        <>
          <Skeleton className="mb-5 h-10 w-60 rounded-md" />
          <div className="flex w-full flex-wrap gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-64 w-full rounded-md md:max-w-[330px]"
              />
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
              const formattedVeMento = Number(
                formatUnits(veMentoAmount, 18),
              ).toLocaleString("en-US", {
                maximumFractionDigits: 3,
              });

              const cliffEnd = subWeeks(lock.expiration, lock.slope);
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
                                <div className="space-y-1">
                                  <p className="text-xs font-medium">
                                    Lock ID: {lock.lockId}
                                  </p>
                                  {inCliff ? (
                                    <>
                                      <p>Cliff until {formatDate(cliffEnd)}</p>
                                      <p>
                                        Unlocks beginning on{" "}
                                        {formatDate(cliffEnd)}
                                      </p>
                                    </>
                                  ) : inVesting ? (
                                    <>
                                      <p>
                                        Vesting since {formatDate(cliffEnd)}
                                      </p>
                                      <p>
                                        Unlocks until{" "}
                                        {formatDate(lock.expiration)}
                                      </p>
                                    </>
                                  ) : (
                                    <p>Expired</p>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </LockCardFieldValue>
                      </LockCardField>
                    </LockCardRow>
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
          <div className="flex flex-wrap gap-4">
            {pastLocks.map((lock) => {
              const badgeType = getBadgeType(lock);
              const delegationInfo = getDelegationInfo(lock, badgeType);

              // Get estimates for this lock
              const estimates = lockEstimates.get(lock.lockId);
              const remainingAmount =
                estimates?.remaining ?? BigInt(lock.amount);
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

              const expired = lock.expiration < new Date();

              return (
                <LockCard key={lock.lockId} id={`lock-${lock.lockId}`}>
                  <LockCardHeader>
                    <LockCardHeaderGroup>
                      <LockCardAmount>{formattedRemaining}</LockCardAmount>
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
