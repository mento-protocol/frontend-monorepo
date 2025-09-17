import { Button, cn, toast } from "@repo/ui";
import {
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
  LOCKING_DELEGATE_ENABLED_FORM_KEY,
  LOCKING_DELEGATE_ADDRESS_FORM_KEY,
  LockWithExpiration,
  useAllowance,
  useApprove,
  useContracts,
  useCurrentChain,
  useLockInfo,
  useLockingWeek,
  useRelockMento,
} from "@repo/web3";
import { isValidAddress } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { differenceInWeeks, isAfter } from "date-fns";
import React from "react";
import { useFormContext } from "react-hook-form";
import { parseEther } from "viem";
import { TxDialog } from "../tx-dialog/tx-dialog";
import {
  CREATE_LOCK_APPROVAL_STATUS,
  CREATE_LOCK_TX_STATUS,
  useCreateLock,
} from "./create-lock-provider";

interface LockingButtonProps {
  lockToUpdate?: LockWithExpiration;
  className?: string;
  onLockUpdated?: () => void;
}

export const LockingButton = ({
  lockToUpdate,
  className,
  onLockUpdated,
}: LockingButtonProps) => {
  const { address } = useAccount();
  const { createLock, CreateLockTxStatus, CreateLockApprovalStatus } =
    useCreateLock();
  const { hasMultipleLocks, refetch: refetchLockInfo } = useLockInfo(address);

  // Use the specific lock to update or fall back to the user's primary lock
  const targetLock = lockToUpdate;

  // Determine if we have enough info to relock this specific lock regardless of expiration
  const canRelockTarget = React.useMemo(() => {
    return !!(
      targetLock &&
      targetLock.lockId &&
      targetLock.owner?.id &&
      targetLock.cliff !== undefined &&
      targetLock.amount !== undefined
    );
  }, [targetLock]);
  const currentChain = useCurrentChain();
  const contracts = useContracts();
  const { currentWeek: currentLockingWeek } = useLockingWeek();
  const [isTxDialogOpen, setIsTxDialogOpen] = React.useState(false);
  const [hasApprovedForCurrentRelock, setHasApprovedForCurrentRelock] =
    React.useState(false);

  const {
    watch,
    formState: { isValid, errors },
    handleSubmit,
    reset: resetForm,
  } = useFormContext();

  const amount = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);
  const delegateEnabled = watch(LOCKING_DELEGATE_ENABLED_FORM_KEY);
  const delegateAddressInput = watch(LOCKING_DELEGATE_ADDRESS_FORM_KEY);
  const parsedAmount = React.useMemo(() => {
    if (!amount || amount === "") return BigInt(0);
    return parseEther(amount);
  }, [amount]);

  const isExtendingDuration = React.useMemo(() => {
    if (!targetLock?.expiration || !unlockDate) return false;
    const currentExpiration = new Date(targetLock.expiration);
    const selectedDate = new Date(unlockDate);
    return isAfter(selectedDate.setHours(0, 0, 0, 0), currentExpiration);
  }, [targetLock?.expiration, unlockDate]);

  const isAddingAmount = React.useMemo(() => {
    if (!amount || amount === "" || amount === "0") return false;
    return parsedAmount > BigInt(0);
  }, [amount, parsedAmount]);

  const isBalanceInsufficient = errors[LOCKING_AMOUNT_FORM_KEY]?.type === "max";

  const newSlope = React.useMemo(() => {
    if (!unlockDate || !targetLock || !currentLockingWeek) return 0;

    const lockTime = Number(targetLock?.time ?? 0);
    const lockSlope = Number(targetLock?.slope ?? 0);
    const lockExpiration = targetLock?.expiration;

    if (!lockExpiration) return 0;

    const currentDate = new Date();
    const totalWeeksToUnlock = differenceInWeeks(unlockDate, currentDate) + 1;

    const weeksPassed = Number(currentLockingWeek) - lockTime;
    const currentRemainingSlope = Math.max(0, lockSlope - weeksPassed);

    return Math.max(totalWeeksToUnlock, currentRemainingSlope);
  }, [currentLockingWeek, targetLock, unlockDate]);

  const requestedDelegate: string | undefined = React.useMemo(() => {
    if (
      delegateEnabled &&
      delegateAddressInput &&
      isValidAddress(delegateAddressInput)
    ) {
      return delegateAddressInput;
    }
    return undefined;
  }, [delegateAddressInput, delegateEnabled]);

  const nextDelegate = React.useMemo(() => {
    const currentDelegate = targetLock?.delegate?.id as string | undefined;
    if (requestedDelegate && requestedDelegate !== currentDelegate) {
      return requestedDelegate;
    }
    return address;
  }, [requestedDelegate, address, targetLock]);

  const relock = useRelockMento({
    lock: targetLock,
    newSlope,
    additionalAmountToLock: parsedAmount,
    newDelegate: nextDelegate,
    onConfirmation: () => {
      const explorerUrl = currentChain.blockExplorers?.default?.url;
      const explorerTxUrl = explorerUrl
        ? `${explorerUrl}/tx/${relock.hash}`
        : null;

      const message = "Lock updated successfully";
      const detailsElement = explorerTxUrl ? (
        <a
          href={explorerTxUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline", color: "inherit" }}
        >
          See Details
        </a>
      ) : (
        <span>See Details</span>
      );

      toast.success(
        <>
          {message} <br /> {detailsElement}
        </>,
      );
      resetForm();
      setIsTxDialogOpen(false);

      refetchLockInfo();

      setTimeout(() => {
        refetchLockInfo();
      }, 2000);

      setTimeout(() => {
        refetchLockInfo();
      }, 5000);

      setTimeout(() => {
        refetchLockInfo();
      }, 10000);

      onLockUpdated?.();
    },
  });

  // Approval setup for relock
  const approve = useApprove();
  const allowance = useAllowance({
    owner: address,
    spender: contracts.Locking.address,
  });

  // Check if approval is needed for relock
  const needsApprovalForRelock = React.useMemo(() => {
    if (!targetLock) return false;

    // Calculate the actual amount that will be transferred
    // The contract will transfer: newTotal - currentLockAmount
    const currentLockAmount = BigInt(targetLock.amount || 0);
    const newTotalAmount = parsedAmount + currentLockAmount;
    const actualTransferAmount = newTotalAmount - currentLockAmount;

    // No approval needed if not adding any tokens
    if (actualTransferAmount === BigInt(0)) return false;

    // Check if current allowance is sufficient for the actual transfer
    if (!allowance.data) return true;
    return allowance.data < actualTransferAmount;
  }, [allowance.data, parsedAmount, targetLock]);

  // Combined status for relock flow
  const isRelocking = React.useMemo(() => {
    return (
      approve.isAwaitingUserSignature ||
      approve.isConfirming ||
      relock.isAwaitingUserSignature ||
      relock.isConfirming
    );
  }, [
    approve.isAwaitingUserSignature,
    approve.isConfirming,
    relock.isAwaitingUserSignature,
    relock.isConfirming,
  ]);

  // Handler for relock
  const handleRelock = React.useCallback(() => {
    if (!targetLock) {
      toast.error("Cannot update lock: lock information is missing");
      return;
    }

    relock.reset();
    approve.reset();
    setIsTxDialogOpen(true);
    setHasApprovedForCurrentRelock(false);

    const submitRelock = () => {
      relock.relockMento({
        onSuccess: () => {
          // Success handled in onConfirmation above - dialog stays open until confirmed
        },
        onError: (error) => {
          console.error("Relock failed", error);
          toast.error("Failed to update lock");
        },
      });
    };

    if (needsApprovalForRelock) {
      // Approve the actual amount that will be transferred
      const actualTransferAmount = parsedAmount; // This is the additional amount being added
      approve.approveMento({
        target: contracts.Locking.address,
        amount: actualTransferAmount,
        onConfirmation: () => {
          setHasApprovedForCurrentRelock(true);
          submitRelock();
        },
        onError: (error) => {
          console.error("Approval failed", error);
          toast.error("Failed to approve MENTO");
        },
      });
    } else {
      submitRelock();
    }
  }, [
    targetLock,
    needsApprovalForRelock,
    approve,
    relock,
    parsedAmount,
    contracts.Locking.address,
  ]);

  const buttonLocator = getButtonLocator({
    address: address ?? "",
    amount,
    canRelockTarget,
    isExtendingDuration,
    isBalanceInsufficient,
    lock: targetLock,
    needsApprovalForRelock,
    isAddingAmount,
    CreateLockApprovalStatus,
    hasMultipleLocks,
  });
  const content = React.useMemo(() => {
    // Not connected
    if (!address) {
      return <>Connect wallet</>;
    }

    // Both topping up and extending duration are now supported for the selected lock
    if (!amount || amount === "" || amount === "0") {
      // Allow empty or 0 amount if user is extending lock duration
      if (canRelockTarget && isExtendingDuration) {
        return <>Extend lock</>;
      }
      return <>Enter amount</>;
    }

    // Amount exceeds balance
    if (isBalanceInsufficient) {
      return <>Insufficient balance</>;
    }

    // Update specific lock (relock) flow
    if (canRelockTarget) {
      // Approval needed for relock
      if (needsApprovalForRelock) {
        return <>Approve MENTO</>;
      }

      // Determine button text based on what's changing
      if (isExtendingDuration && isAddingAmount) {
        return <>Top up and extend lock</>;
      } else if (isExtendingDuration && !isAddingAmount) {
        return <>Extend lock</>;
      } else if (!isExtendingDuration && isAddingAmount) {
        return <>Top up lock</>;
      }

      // Fallback (shouldn't reach here in normal flow)
      return <>Top up lock</>;
    }

    // New lock flow - approval needed
    if (CreateLockApprovalStatus === CREATE_LOCK_APPROVAL_STATUS.NOT_APPROVED) {
      return <>Approve MENTO</>;
    }

    return <>Lock MENTO</>;
  }, [
    address,
    amount,
    isBalanceInsufficient,
    CreateLockApprovalStatus,
    canRelockTarget,
    hasMultipleLocks,
    needsApprovalForRelock,
    parsedAmount,
    isExtendingDuration,
    isAddingAmount,
    targetLock,
  ]);

  const shouldButtonBeDisabled = React.useMemo(() => {
    // Basic checks
    if (!address || !isValid || isBalanceInsufficient) {
      return true;
    }

    // Check amount requirements
    const isAmountEmpty = !amount || amount === "" || amount === "0";
    if (isAmountEmpty) {
      // Allow empty or 0 amount only if user is extending lock duration
      if (!(canRelockTarget && isExtendingDuration)) {
        return true;
      }
    }

    // Relock flow checks
    if (canRelockTarget) {
      // Disable during relock transaction
      if (isRelocking) {
        return true;
      }

      return false;
    }

    // New lock flow - disable during transaction
    if (
      CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ||
      CreateLockTxStatus === CREATE_LOCK_TX_STATUS.AWAITING_SIGNATURE ||
      CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_LOCK_TX
    ) {
      return true;
    }

    return false;
  }, [
    address,
    hasMultipleLocks,
    amount,
    isValid,
    isBalanceInsufficient,
    canRelockTarget,
    parsedAmount,
    isRelocking,
    CreateLockTxStatus,
    isExtendingDuration,
    isAddingAmount,
    unlockDate,
    targetLock,
  ]);
  const relockTxStatus = React.useMemo(() => {
    if (approve.error || relock.error) return "ERROR";
    if (approve.isAwaitingUserSignature || relock.isAwaitingUserSignature)
      return "AWAITING_SIGNATURE";
    if (approve.isConfirming) return "CONFIRMING_APPROVE_TX";
    if (relock.isConfirming) return "CONFIRMING_RELOCK_TX";
    return "UNKNOWN";
  }, [
    approve.error,
    approve.isAwaitingUserSignature,
    approve.isConfirming,
    relock.error,
    relock.isAwaitingUserSignature,
    relock.isConfirming,
  ]);

  // Transaction dialog message component
  const TxMessage = React.useCallback(() => {
    const isApprovalActive =
      (approve.isAwaitingUserSignature || approve.isConfirming) &&
      !hasApprovedForCurrentRelock;
    const isAwaiting =
      approve.isAwaitingUserSignature || relock.isAwaitingUserSignature;
    const isConfirming = approve.isConfirming || relock.isConfirming;

    return (
      <div className="flex min-h-4 flex-col gap-4">
        <span>{isApprovalActive ? "Approve MENTO" : "Update Lock"}</span>
        {isAwaiting ? (
          <>Continue in wallet</>
        ) : isConfirming ? (
          <>Confirming...</>
        ) : null}
      </div>
    );
  }, [
    approve.isAwaitingUserSignature,
    approve.isConfirming,
    relock.isAwaitingUserSignature,
    relock.isConfirming,
    hasApprovedForCurrentRelock,
  ]);

  // Reset function for dialog
  const resetRelockState = React.useCallback(() => {
    setIsTxDialogOpen(false);
    approve.reset();
    relock.reset();
    setHasApprovedForCurrentRelock(false);
  }, [approve, relock]);

  return (
    <>
      <Button
        className={cn("w-full", className)}
        disabled={shouldButtonBeDisabled}
        onClick={(e: React.MouseEvent) => {
          handleSubmit(() => {
            if (canRelockTarget) {
              handleRelock();
            } else {
              createLock();
            }
          })(e);
        }}
        size="lg"
        clipped="lg"
        data-testid={buttonLocator}
      >
        {content}
      </Button>

      {/* Transaction Dialog for Relock */}
      <TxDialog
        isOpen={isTxDialogOpen}
        onClose={resetRelockState}
        error={relockTxStatus === "ERROR"}
        title="Update Lock"
        retry={handleRelock}
        message={<TxMessage />}
        dataTestId="relock-tx-dialog"
        preventClose={isRelocking}
        isPending={isRelocking}
      />
    </>
  );
};

function getButtonLocator({
  address,
  amount,
  canRelockTarget,
  isExtendingDuration,
  isBalanceInsufficient,
  lock,
  needsApprovalForRelock,
  isAddingAmount,
  CreateLockApprovalStatus,
  hasMultipleLocks,
}: {
  address: string;
  amount: string;
  canRelockTarget: boolean;
  isExtendingDuration: boolean;
  isBalanceInsufficient: boolean;
  lock: LockWithExpiration | undefined;
  needsApprovalForRelock: boolean;
  isAddingAmount: boolean;
  CreateLockApprovalStatus: CREATE_LOCK_APPROVAL_STATUS;
  hasMultipleLocks: boolean;
}) {
  return React.useMemo(() => {
    // Not connected
    if (!address) {
      return "connectWalletButton";
    }

    // Both topping up and extending duration are now supported for the first lock
    if (!amount || amount === "" || amount === "0") {
      // Allow empty or 0 amount if user is extending lock duration
      if (canRelockTarget && isExtendingDuration) {
        return "extendLockButton";
      }
      return "enterAmountButton";
    }

    // Amount exceeds balance
    if (isBalanceInsufficient) {
      return "insufficientBalanceButton";
    }

    // Has active lock - relock flow
    if (canRelockTarget && lock?.expiration && lock.expiration > new Date()) {
      // Approval needed for relock
      if (needsApprovalForRelock) {
        return "approveMentoButton";
      }

      // Determine button text based on what's changing
      if (isExtendingDuration && isAddingAmount) {
        return "topUpAndExtendLockButton";
      } else if (isExtendingDuration && !isAddingAmount) {
        return "extendLockButton";
      } else if (!isExtendingDuration && isAddingAmount) {
        return "topUpLockButton";
      }

      // Fallback (shouldn't reach here in normal flow)
      return "topUpLockButton";
    }

    // New lock flow - approval needed
    if (CreateLockApprovalStatus === CREATE_LOCK_APPROVAL_STATUS.NOT_APPROVED) {
      return "approveMentoButton";
    }

    return "lockMentoButton";
  }, [
    address,
    amount,
    isBalanceInsufficient,
    CreateLockApprovalStatus,
    canRelockTarget,
    hasMultipleLocks,
    needsApprovalForRelock,
    isExtendingDuration,
    isAddingAmount,
  ]);
}
