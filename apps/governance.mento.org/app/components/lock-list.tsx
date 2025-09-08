"use client";
import {
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
import { useLocksByAccount } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { formatUnits } from "viem";

export const LockList = () => {
  const { address } = useAccount();
  const { locks, refetch } = useLocksByAccount({ account: address! });

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

  if (!locks || locks.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-xl font-semibold">Your Locks</h2>
        <p className="text-muted-foreground">No locks found.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Your Locks</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {locks.map((lock) => {
          const badgeType = getBadgeType(lock);
          const delegationInfo = getDelegationInfo(lock, badgeType);
          const withdrawable = canWithdraw(lock);
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

              {delegationInfo && (
                <LockCardDelegationInfo>
                  <LockCardDelegationLabel>
                    {delegationInfo.label}
                  </LockCardDelegationLabel>
                  <LockCardDelegationAddress>
                    {delegationInfo.address}
                  </LockCardDelegationAddress>
                </LockCardDelegationInfo>
              )}

              <LockCardBody>
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
                          <span className="text-muted-foreground">MENTO</span>
                        </>
                      ) : (
                        <>
                          0 <span className="text-muted-foreground">MENTO</span>
                        </>
                      )}
                      {badgeType === "received" && (
                        <span className="ml-1 text-xs">ⓘ</span>
                      )}
                    </LockCardFieldValue>
                  </LockCardField>
                </LockCardRow>
              </LockCardBody>

              {badgeType === "personal" && (
                <LockCardActions>
                  <LockCardButton>Update</LockCardButton>
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
    </div>
  );
};
