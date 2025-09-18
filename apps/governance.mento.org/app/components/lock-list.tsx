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
import { useState } from "react";
import { formatUnits } from "viem";
import { UpdateLockDialog } from "./update-lock-dialog";
export const LockList = () => {
  const { address } = useAccount();
  const { locks, refetch } = useLocksByAccount({ account: address as string });
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
      {activeLocks.length > 0 && (
        <>
          <h2 className="mb-8 text-2xl font-medium">Your current locks</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {activeLocks.map((lock, index) => {
              const badgeType = getBadgeType(lock);
              const delegationInfo = getDelegationInfo(lock, badgeType);
              const formattedAmount = formatAmount(lock.amount);
              const cliffEnd = subWeeks(lock.expiration, lock.slope);
              const hasActiveCliff = lock.cliff > 0 && new Date() < cliffEnd;

              return (
                <LockCard key={lock.lockId}>
                  <LockCardHeader>
                    <LockCardHeaderGroup>
                      <LockCardAmount>{formattedAmount}</LockCardAmount>
                      <LockCardToken>veMENTO</LockCardToken>
                    </LockCardHeaderGroup>
                    <LockCardBadge type={badgeType}>
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
                        <LockCardFieldLabel>Locked</LockCardFieldLabel>
                        <LockCardFieldValue>
                          {formattedAmount}{" "}
                          <span className="text-muted-foreground">MENTO</span>
                        </LockCardFieldValue>
                      </LockCardField>
                      <LockCardField>
                        <LockCardFieldLabel>ID</LockCardFieldLabel>
                        <LockCardFieldValue>
                          {lock.lockCreate?.[0]?.transaction?.id ? (
                            <a
                              className="underline-offset-2 hover:underline"
                              href={`${explorerUrl}/tx/${lock.lockCreate?.[0]?.transaction?.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {lock.lockId}
                            </a>
                          ) : (
                            lock.lockId
                          )}
                        </LockCardFieldValue>
                      </LockCardField>
                    </LockCardRow>

                    <LockCardRow>
                      <LockCardField>
                        <LockCardFieldLabel>Expires</LockCardFieldLabel>
                        <LockCardFieldValue className="flex items-center gap-1">
                          {formatDate(lock.expiration)}
                          {hasActiveCliff && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="text-muted-foreground ml-1 size-4" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Cliff until {formatDate(cliffEnd)}</p>
                                  <p>
                                    Unlocks beginning on {formatDate(cliffEnd)}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </LockCardFieldValue>
                      </LockCardField>
                    </LockCardRow>
                  </LockCardBody>

                  {badgeType !== "received" && (
                    <LockCardActions>
                      <LockCardButton
                        onClick={() => handleUpdateLock(lock)}
                        data-testid={`lockCard_${index}`}
                      >
                        Update
                      </LockCardButton>
                    </LockCardActions>
                  )}

                  {badgeType === "received" && (
                    <LockCardNotice>
                      Only the lock owner can update delegated locks{" "}
                      <a
                        className="text-muted-foreground text-sm font-medium"
                        href={`${explorerUrl}/address/${lock.owner.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {WalletHelper.getShortAddress(lock.owner.id)}
                      </a>
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
          <h2 className="my-8 mt-12 text-2xl font-medium">Your past locks</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {pastLocks.map((lock) => {
              const badgeType = getBadgeType(lock);
              const delegationInfo = getDelegationInfo(lock, badgeType);
              const isOwner =
                lock.owner.id.toLowerCase() === address?.toLowerCase();
              const amt = Number(formatUnits(BigInt(lock.amount), 18));

              // Allocate contract-total across my expired locks
              let toWithdraw = 0;
              if (isOwner && remaining > 0) {
                toWithdraw = Math.min(amt, remaining);
                remaining -= toWithdraw;
              }

              const formattedAmount = formatAmount(lock.amount);
              const expired = lock.expiration < new Date();

              return (
                <LockCard key={lock.lockId}>
                  <LockCardHeader>
                    <LockCardHeaderGroup>
                      <LockCardAmount>{formattedAmount}</LockCardAmount>
                      <LockCardToken>
                        {badgeType === "received" ? "veMENTO" : "MENTO"}
                      </LockCardToken>
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
                        <LockCardFieldLabel>Locked</LockCardFieldLabel>
                        <LockCardFieldValue>
                          {formattedAmount}{" "}
                          <span className="text-muted-foreground">MENTO</span>
                        </LockCardFieldValue>
                      </LockCardField>
                      <LockCardField>
                        <LockCardFieldLabel>ID</LockCardFieldLabel>
                        <LockCardFieldValue>{lock.lockId}</LockCardFieldValue>
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
