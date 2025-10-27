import {
  useAllowance,
  useApprove,
  useLockInfo,
  useLockingWeek,
  useRelockMento,
} from "@/contracts";
import {
  useOptimisticLocks,
  OptimisticLock,
} from "@/contexts/optimistic-locks-context";
import {
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_DELEGATE_ADDRESS_FORM_KEY,
  LOCKING_DELEGATE_ENABLED_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
} from "@/contracts/locking/config";
import { LockWithExpiration } from "@/contracts/types";
import { useCurrentChain } from "@/hooks/use-current-chain";
import { Button, cn, toast } from "@repo/ui";
import { isValidAddress, useContracts } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { differenceInWeeks, isAfter } from "date-fns";
import { useFormContext } from "react-hook-form";
import { parseEther } from "viem";
import { TxDialog } from "../tx-dialog/tx-dialog";
import {
  CREATE_LOCK_APPROVAL_STATUS,
  CREATE_LOCK_TX_STATUS,
  useCreateLock,
} from "./create-lock-provider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Account } from "@/graphql";

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
  const { refetch: refetchLockInfo } = useLockInfo(address);
  const { addOptimisticLock } = useOptimisticLocks();

  // Use the specific lock to update or fall back to the user's primary lock
  const targetLock = lockToUpdate;

  // Determine if we have enough info to relock this specific lock regardless of expiration
  const canRelockTarget = useMemo(() => {
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
  const [isTxDialogOpen, setIsTxDialogOpen] = useState(false);
  const [hasApprovedForCurrentRelock, setHasApprovedForCurrentRelock] =
    useState(false);
  const [relockError, setRelockError] = useState(false);

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

  const isAmountFormatValid = useMemo(() => {
    if (amount === undefined || amount === null) return true;
    const s = String(amount).trim();
    if (s === "") return true;
    const re = /^(?:\d+)(?:\.\d{1,18})?$/;
    return re.test(s);
  }, [amount]);

  const parsedAmount = useMemo(() => {
    try {
      if (!amount || amount === "") return BigInt(0);
      const normalized = String(amount).trim();
      if (normalized === "" || normalized === "0") return BigInt(0);
      if (!isAmountFormatValid) return BigInt(0);
      const parsed = parseEther(normalized as string);
      // Ensure parsed amount is either 0 or >= 1 MENTO
      const minAmount = parseEther("1");
      if (parsed > 0n && parsed < minAmount) {
        return BigInt(0); // Invalid amount that rounds below minimum
      }
      return parsed;
    } catch {
      return BigInt(0);
    }
  }, [amount, isAmountFormatValid]);

  const isExtendingDuration = useMemo(() => {
    if (!targetLock?.expiration || !unlockDate) return false;
    const currentExpiration = new Date(targetLock.expiration);
    const selectedDate = new Date(unlockDate);
    return isAfter(selectedDate.setHours(0, 0, 0, 0), currentExpiration);
  }, [targetLock?.expiration, unlockDate]);

  const isAddingAmount = useMemo(() => {
    if (!isAmountFormatValid) return false;
    if (!amount || amount === "" || amount === "0") return false;
    return parsedAmount > BigInt(0);
  }, [amount, parsedAmount, isAmountFormatValid]);

  const isBalanceInsufficient = errors[LOCKING_AMOUNT_FORM_KEY]?.type === "max";
  const isBelowMinimum = errors[LOCKING_AMOUNT_FORM_KEY]?.type === "min";

  const newSlope = useMemo(() => {
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

  const requestedDelegate: string | undefined = useMemo(() => {
    if (
      delegateEnabled &&
      delegateAddressInput &&
      isValidAddress(delegateAddressInput)
    ) {
      return delegateAddressInput;
    }
    // If delegation is disabled, delegate to self
    if (!delegateEnabled) {
      return address;
    }
    return undefined;
  }, [delegateAddressInput, delegateEnabled, address]);

  const nextDelegate = useMemo(() => {
    const currentDelegate = targetLock?.delegate?.id as string | undefined;
    if (requestedDelegate && requestedDelegate !== currentDelegate) {
      return requestedDelegate;
    }
    return currentDelegate || address;
  }, [requestedDelegate, address, targetLock]);

  const isChangingDelegate = useMemo(() => {
    if (!targetLock) return false;
    const currentDelegate = (targetLock.delegate?.id ?? "").toLowerCase();
    const newDelegate = (nextDelegate ?? "").toLowerCase();
    return currentDelegate !== newDelegate;
  }, [targetLock, nextDelegate]);

  const relock = useRelockMento({
    lock: targetLock,
    newSlope,
    additionalAmountToLock: parsedAmount,
    newDelegate: nextDelegate as `0x${string}`,
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
  const needsApprovalForRelock = useMemo(() => {
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
  const isRelocking = useMemo(() => {
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
  const handleRelock = useCallback(() => {
    if (!targetLock) {
      toast.error("Cannot update lock: lock information is missing");
      return;
    }

    relock.reset();
    approve.reset();
    setIsTxDialogOpen(true);
    setHasApprovedForCurrentRelock(false);
    setRelockError(false);

    const submitRelock = () => {
      // Create optimistic updated lock
      const currentDate = new Date();
      const totalWeeksToUnlock = differenceInWeeks(unlockDate, currentDate) + 1;
      const expirationDate = new Date(
        currentDate.getTime() + totalWeeksToUnlock * 7 * 24 * 60 * 60 * 1000,
      );

      const updatedAmount = BigInt(targetLock.amount) + parsedAmount;

      const optimisticLock: OptimisticLock = {
        ...targetLock,
        amount: updatedAmount.toString(),
        delegate: {
          id: nextDelegate || targetLock.delegate.id,
        } as unknown as Account,
        expiration: expirationDate,
        slope: newSlope,
        isOptimistic: true,
      };

      // Add optimistic lock immediately (will replace the old one in the UI)
      addOptimisticLock(optimisticLock);

      relock.relockMento({
        onSuccess: () => {
          // Success handled in onConfirmation above - dialog stays open until confirmed
        },
        onError: (error) => {
          console.error("Relock failed", error);
          toast.error("Failed to update lock");
          setRelockError(true);
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
          setRelockError(true);
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
    addOptimisticLock,
    unlockDate,
    nextDelegate,
    newSlope,
  ]);

  const buttonLocator = useMemo(() => {
    return getButtonLocator({
      address: address ?? "",
      amount,
      canRelockTarget,
      isExtendingDuration,
      isBalanceInsufficient,
      lock: targetLock,
      needsApprovalForRelock,
      isAddingAmount,
      isChangingDelegate,
      CreateLockApprovalStatus,
    });
  }, [
    address,
    amount,
    canRelockTarget,
    isExtendingDuration,
    isBalanceInsufficient,
    targetLock,
    needsApprovalForRelock,
    isAddingAmount,
    isChangingDelegate,
    CreateLockApprovalStatus,
  ]);
  const content = useMemo(() => {
    // Not connected
    if (!address) {
      return <>Connect wallet</>;
    }

    if (!isAmountFormatValid) {
      if (canRelockTarget && isExtendingDuration) {
        return <>Extend lock</>;
      }
      return <>Enter amount</>;
    }

    if (
      !amount ||
      amount === "" ||
      amount === "0" ||
      parsedAmount === BigInt(0)
    ) {
      if (canRelockTarget && isExtendingDuration) {
        return <>Extend lock</>;
      }
      if (canRelockTarget && isChangingDelegate) {
        // Check if delegating to self
        const isDelegatingToSelf =
          nextDelegate?.toLowerCase() === address?.toLowerCase();
        return isDelegatingToSelf ? (
          <>Delegate to self</>
        ) : (
          <>Change delegate</>
        );
      }
      return <>Enter amount</>;
    }

    if (isBalanceInsufficient) {
      return <>Insufficient balance</>;
    }

    if (isBelowMinimum) {
      return <>Minimum 1 MENTO</>;
    }

    if (canRelockTarget) {
      if (needsApprovalForRelock) {
        return <>Approve MENTO</>;
      }
      if (isExtendingDuration && isAddingAmount && isChangingDelegate) {
        return <>Top up, extend and change delegate</>;
      } else if (isExtendingDuration && isAddingAmount) {
        return <>Top up and extend lock</>;
      } else if (isExtendingDuration && isChangingDelegate) {
        return <>Extend and change delegate</>;
      } else if (isExtendingDuration && !isAddingAmount) {
        return <>Extend lock</>;
      } else if (isAddingAmount && isChangingDelegate) {
        return <>Top up and change delegate</>;
      } else if (!isExtendingDuration && isAddingAmount) {
        return <>Top up lock</>;
      } else if (isChangingDelegate) {
        // Check if delegating to self
        const isDelegatingToSelf =
          nextDelegate?.toLowerCase() === address?.toLowerCase();
        return isDelegatingToSelf ? (
          <>Delegate to self</>
        ) : (
          <>Change delegate</>
        );
      }
      return <>Top up lock</>;
    }

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
    needsApprovalForRelock,
    isExtendingDuration,
    isAddingAmount,
    isChangingDelegate,
    isAmountFormatValid,
    isBelowMinimum,
    parsedAmount,
    nextDelegate,
  ]);

  const shouldButtonBeDisabled = useMemo(() => {
    if (!address || !isValid || isBalanceInsufficient || isBelowMinimum) {
      return true;
    }

    if (!isAmountFormatValid) {
      return true;
    }

    const isAmountEmpty =
      !amount || amount === "" || amount === "0" || parsedAmount === BigInt(0);
    if (isAmountEmpty) {
      if (!(canRelockTarget && (isExtendingDuration || isChangingDelegate))) {
        return true;
      }
    }

    if (canRelockTarget) {
      if (isRelocking) {
        return true;
      }

      return false;
    }

    // New lock flow: require unlock date
    if (!canRelockTarget && !unlockDate) {
      return true;
    }

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
    amount,
    isValid,
    isBalanceInsufficient,
    canRelockTarget,
    parsedAmount,
    isRelocking,
    CreateLockTxStatus,
    isExtendingDuration,
    isChangingDelegate,
    isAmountFormatValid,
    isBelowMinimum,
    unlockDate,
  ]);
  const relockTxStatus = useMemo(() => {
    if (relockError || approve.error || relock.error) return "ERROR";
    if (approve.isAwaitingUserSignature || relock.isAwaitingUserSignature)
      return "AWAITING_SIGNATURE";
    if (approve.isConfirming) return "CONFIRMING_APPROVE_TX";
    if (relock.isConfirming) return "CONFIRMING_RELOCK_TX";
    return "UNKNOWN";
  }, [
    relockError,
    approve.error,
    approve.isAwaitingUserSignature,
    approve.isConfirming,
    relock.error,
    relock.isAwaitingUserSignature,
    relock.isConfirming,
  ]);

  // Transaction dialog message component
  const TxMessage = useCallback(() => {
    const isApprovalActive =
      (approve.isAwaitingUserSignature || approve.isConfirming) &&
      !hasApprovedForCurrentRelock;
    const isAwaiting =
      approve.isAwaitingUserSignature || relock.isAwaitingUserSignature;
    const isConfirming = approve.isConfirming || relock.isConfirming;

    return (
      <div className="flex min-h-4 flex-col gap-4">
        <span data-testid="actionLabel">
          {isApprovalActive
            ? "Approve MENTO"
            : isExtendingDuration && isAddingAmount && isChangingDelegate
              ? "Top up, extend and change delegate"
              : isExtendingDuration && isAddingAmount
                ? "Top up and extend lock"
                : isExtendingDuration && isChangingDelegate
                  ? "Extend and change delegate"
                  : isExtendingDuration && !isAddingAmount
                    ? "Extend lock"
                    : isAddingAmount && isChangingDelegate
                      ? "Top up and change delegate"
                      : isChangingDelegate
                        ? nextDelegate?.toLowerCase() === address?.toLowerCase()
                          ? "Delegate to self"
                          : "Change delegate"
                        : "Top up lock"}
        </span>
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
    isExtendingDuration,
    isAddingAmount,
    isChangingDelegate,
    address,
    nextDelegate,
  ]);

  // Toast notifications for relock approval errors
  useEffect(() => {
    if (approve.error && isTxDialogOpen) {
      if (approve.error.message?.includes("User rejected request")) {
        toast.error("Transaction rejected");
      } else {
        toast.error("Transaction failed");
      }
    }
  }, [approve.error, isTxDialogOpen]);

  // Toast notifications for relock transaction errors
  useEffect(() => {
    if (relock.error && isTxDialogOpen) {
      if (relock.error.message?.includes("User rejected request")) {
        toast.error("Transaction rejected");
      } else {
        toast.error("Transaction failed");
      }
    }
  }, [relock.error, isTxDialogOpen]);

  // Reset function for dialog
  const resetRelockState = useCallback(() => {
    setIsTxDialogOpen(false);
    approve.reset();
    relock.reset();
    setHasApprovedForCurrentRelock(false);
    setRelockError(false);
  }, [approve, relock]);

  return (
    <>
      <Button
        className={cn("w-full", className)}
        disabled={shouldButtonBeDisabled}
        onClick={(e) => {
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
  isChangingDelegate,
  CreateLockApprovalStatus,
}: {
  address: string;
  amount: string;
  canRelockTarget: boolean;
  isExtendingDuration: boolean;
  isBalanceInsufficient: boolean;
  lock: LockWithExpiration | undefined;
  needsApprovalForRelock: boolean;
  isAddingAmount: boolean;
  isChangingDelegate: boolean;
  CreateLockApprovalStatus: CREATE_LOCK_APPROVAL_STATUS;
}) {
  const isAmountFormatValid = (() => {
    if (amount === undefined || amount === null) return true;
    const s = String(amount).trim();
    if (s === "") return true;
    const re = /^(?:\d+)(?:\.\d{1,18})?$/;
    return re.test(s);
  })();

  // Not connected
  if (!address) {
    return "connectWalletButton";
  }

  // Invalid amount format
  if (!isAmountFormatValid) {
    if (canRelockTarget && isExtendingDuration) {
      return "extendLockButton";
    }
    return "enterAmountButton";
  }

  // Both topping up and extending duration are now supported for the first lock
  if (!amount || amount === "" || amount === "0") {
    // Allow empty or 0 amount if user is extending lock duration or changing delegate
    if (canRelockTarget && isExtendingDuration) {
      return "extendLockButton";
    }
    if (canRelockTarget && isChangingDelegate) {
      return "changeDelegateButton";
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
    if (isExtendingDuration && isAddingAmount && isChangingDelegate) {
      return "topUpExtendAndChangeDelegateButton";
    } else if (isExtendingDuration && isAddingAmount) {
      return "topUpAndExtendLockButton";
    } else if (isExtendingDuration && isChangingDelegate) {
      return "extendAndChangeDelegateButton";
    } else if (isExtendingDuration && !isAddingAmount) {
      return "extendLockButton";
    } else if (isAddingAmount && isChangingDelegate) {
      return "topUpAndChangeDelegateButton";
    } else if (!isExtendingDuration && isAddingAmount) {
      return "topUpLockButton";
    } else if (isChangingDelegate) {
      return "changeDelegateButton";
    }

    // Fallback (shouldn't reach here in normal flow)
    return "topUpLockButton";
  }

  // New lock flow - approval needed
  if (CreateLockApprovalStatus === CREATE_LOCK_APPROVAL_STATUS.NOT_APPROVED) {
    return "approveMentoButton";
  }

  return "lockMentoButton";
}
