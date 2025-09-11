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
  LockCardDelegationInfo,
  LockCardDelegationLabel,
  LockCardField,
  LockCardFieldLabel,
  LockCardFieldValue,
  LockCardHeader,
  LockCardHeaderGroup,
  LockCardNotice,
  LockCardRow,
  LockCardToken,
  type BadgeType,
} from "@repo/ui";
import {
  Identicon,
  useCurrentChain,
  useLocksByAccount,
  useAvailableToWithdraw,
  WalletHelper,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { useState } from "react";
import { formatUnits } from "viem";
import { UpdateLockDialog } from "./update-lock-dialog";

export const LockList = () => {
  const { address } = useAccount();
  const { locks, refetch } = useLocksByAccount({ account: address! });
  const currentChain = useCurrentChain();
  const { availableToWithdraw } = useAvailableToWithdraw();

  const [selectedLock, setSelectedLock] = useState<any>(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);

  // Helper function to determine badge type based on delegation
  const getBadgeType = (lock: any): BadgeType => {
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

  // Helper function to get delegation info
  const getDelegationInfo = (lock: any, badgeType: BadgeType) => {
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

  // Helper function to check if user can withdraw
  const canWithdraw = (lock: any) => {
    const now = new Date();
    return now > lock.expiration;
  };

  const handleUpdateLock = (lock: any) => {
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
          <h2 className="mb-8 text-2xl font-medium">Your existing locks</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {activeLocks.map((lock) => {
              const badgeType = getBadgeType(lock);
              const delegationInfo = getDelegationInfo(lock, badgeType);
              const formattedAmount = formatAmount(lock.amount);
              const withdrawable = canWithdraw(lock);

              return (
                <LockCard key={lock.lockId}>
                  <LockCardHeader>
                    <LockCardHeaderGroup>
                      <LockCardAmount>{formattedAmount}</LockCardAmount>
                      <LockCardToken>
                        {badgeType === "received" ? "veMENTO" : "MENTO"}
                      </LockCardToken>
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
                        <LockCardFieldValue>{lock.lockId}</LockCardFieldValue>
                      </LockCardField>
                    </LockCardRow>

                    <LockCardRow>
                      <LockCardField>
                        <LockCardFieldLabel>Expires</LockCardFieldLabel>
                        <LockCardFieldValue>
                          {formatDate(lock.expiration)}
                        </LockCardFieldValue>
                      </LockCardField>
                      <LockCardField>
                        <LockCardFieldLabel>To Withdraw</LockCardFieldLabel>
                        <LockCardFieldValue>
                          {withdrawable ? (
                            <>
                              {formattedAmount}{" "}
                              <span className="text-muted-foreground">
                                MENTO
                              </span>
                            </>
                          ) : (
                            <>
                              0{" "}
                              <span className="text-muted-foreground">
                                MENTO
                              </span>
                            </>
                          )}
                          {badgeType === "received" && (
                            <span className="ml-1 text-xs">ⓘ</span>
                          )}
                        </LockCardFieldValue>
                      </LockCardField>
                    </LockCardRow>
                  </LockCardBody>

                  {badgeType !== "received" && (
                    <LockCardActions>
                      <LockCardButton onClick={() => handleUpdateLock(lock)}>
                        Update
                      </LockCardButton>
                    </LockCardActions>
                  )}

                  {badgeType === "received" && (
                    <LockCardNotice>
                      Delegated locks can only be updated by their lock owner{" "}
                      {lock.owner.id}
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

              return (
                <LockCard key={lock.lockId}>
                  <LockCardHeader>
                    <LockCardHeaderGroup>
                      <LockCardAmount>{formattedAmount}</LockCardAmount>
                      <LockCardToken>
                        {badgeType === "received" ? "veMENTO" : "MENTO"}
                      </LockCardToken>
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
                        <LockCardFieldValue>{lock.lockId}</LockCardFieldValue>
                      </LockCardField>
                    </LockCardRow>

                    <LockCardRow>
                      <LockCardField>
                        <LockCardFieldLabel>Expires</LockCardFieldLabel>
                        <LockCardFieldValue>
                          {formatDate(lock.expiration)}
                        </LockCardFieldValue>
                      </LockCardField>
                      <LockCardField>
                        <LockCardFieldLabel>To Withdraw</LockCardFieldLabel>
                        <LockCardFieldValue>
                          {toWithdraw.toLocaleString()}{" "}
                          <span className="text-muted-foreground">MENTO</span>
                          {badgeType === "received" && (
                            <span className="ml-1 text-xs">ⓘ</span>
                          )}
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
