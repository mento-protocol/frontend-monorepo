import {
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
} from "@/lib/constants/locking";
import { useLockInfo } from "@/lib/contracts/locking/useLockInfo";
import useLockingWeek from "@/lib/contracts/locking/useLockingWeek";
import useRelockMento from "@/lib/contracts/locking/useRelockMento";
import { useAllowance } from "@/lib/contracts/mento/useAllowance";
import useApprove from "@/lib/contracts/mento/useApprove";
import { useContracts } from "@/lib/contracts/useContracts";
import { Button, toast } from "@repo/ui";
import { Celo, Alfajores } from "@/lib/config/chains";
import { differenceInWeeks, isAfter } from "date-fns";
import React from "react";
import { useFormContext } from "react-hook-form";
import { parseEther } from "viem";
import { useAccount } from "wagmi";
import { TxDialog } from "../tx-dialog/tx-dialog";
import {
  CREATE_LOCK_APPROVAL_STATUS,
  CREATE_LOCK_TX_STATUS,
  useCreateLock,
} from "./create-lock-provider";
import { LockWithExpiration } from "@/lib/interfaces/lock.interface";

export const LockingButton = () => {
  const { address, chainId } = useAccount();
  const { createLock, CreateLockTxStatus, CreateLockApprovalStatus } =
    useCreateLock();
  const {
    lock,
    hasActiveLock,
    hasMultipleLocks,
    refetch: refetchLockInfo,
  } = useLockInfo(address);
  const contracts = useContracts();
  const { currentWeek: currentLockingWeek } = useLockingWeek();
  const [isTxDialogOpen, setIsTxDialogOpen] = React.useState(false);

  const {
    watch,
    formState: { isValid, errors },
    handleSubmit,
    reset: resetForm,
  } = useFormContext();

  const amount = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);
  const parsedAmount = React.useMemo(() => {
    if (!amount || amount === "") return BigInt(0);
    return parseEther(amount);
  }, [amount]);

  const isExtendingDuration = React.useMemo(() => {
    if (!hasActiveLock || !lock?.expiration || !unlockDate) return false;
    const currentExpiration = new Date(lock.expiration);
    const selectedDate = new Date(unlockDate);
    return isAfter(selectedDate.setHours(0, 0, 0, 0), currentExpiration);
  }, [hasActiveLock, lock?.expiration, unlockDate]);

  const isAddingAmount = React.useMemo(() => {
    if (!hasActiveLock || !amount || amount === "" || amount === "0")
      return false;
    return parsedAmount > BigInt(0);
  }, [hasActiveLock, amount, parsedAmount]);

  const isBalanceInsufficient = errors[LOCKING_AMOUNT_FORM_KEY]?.type === "max";

  const newSlope = React.useMemo(() => {
    if (!unlockDate || !lock || !hasActiveLock || !currentLockingWeek) return 0;

    const lockTime = lock?.time ?? 0;
    const lockSlope = lock?.slope ?? 0;
    const lockExpiration = lock?.expiration;

    if (!lockExpiration) return 0;

    const currentDate = new Date();
    const totalWeeksToUnlock = differenceInWeeks(unlockDate, currentDate) + 1;

    const weeksPassed = Number(currentLockingWeek) - lockTime;
    const currentRemainingSlope = Math.max(0, lockSlope - weeksPassed);

    return Math.max(totalWeeksToUnlock, currentRemainingSlope);
  }, [currentLockingWeek, lock, unlockDate, hasActiveLock]);

  const relock = useRelockMento({
    lock,
    newSlope,
    additionalAmountToLock: parsedAmount,
    onConfirmation: () => {
      const currentChain = chainId === Celo.id ? Celo : Alfajores;
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
    if (!hasActiveLock) return false;
    if (parsedAmount === BigInt(0)) return false;
    if (!allowance.data) return true;
    return allowance?.data < parsedAmount;
  }, [allowance.data, parsedAmount, hasActiveLock]);

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
    if (!lock) {
      toast.error("Cannot update lock: lock information is missing");
      return;
    }

    relock.reset();
    approve.reset();
    setIsTxDialogOpen(true);

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
      approve.approveMento({
        target: contracts.Locking.address,
        amount: parsedAmount,
        onConfirmation: submitRelock,
        onError: (error) => {
          console.error("Approval failed", error);
          toast.error("Failed to approve MENTO");
        },
      });
    } else {
      submitRelock();
    }
  }, [
    lock,
    needsApprovalForRelock,
    approve,
    relock,
    parsedAmount,
    contracts.Locking.address,
  ]);

  const buttonLocator = getButtonLocator({
    address: address ?? "",
    amount,
    hasActiveLock,
    isExtendingDuration,
    isBalanceInsufficient,
    lock,
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

    // Both topping up and extending duration are now supported for the first lock
    if (!amount || amount === "" || amount === "0") {
      // Allow empty or 0 amount if user is extending lock duration
      if (hasActiveLock && isExtendingDuration) {
        return <>Extend lock</>;
      }
      return <>Enter amount</>;
    }

    // Amount exceeds balance
    if (isBalanceInsufficient) {
      return <>Insufficient balance</>;
    }

    // Has active lock - relock flow
    if (hasActiveLock && lock?.expiration && lock.expiration > new Date()) {
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
    hasActiveLock,
    hasMultipleLocks,
    needsApprovalForRelock,
    parsedAmount,
    isExtendingDuration,
    isAddingAmount,
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
      if (!(hasActiveLock && isExtendingDuration)) {
        return true;
      }
    }

    // Has active lock - relock flow checks
    if (hasActiveLock && lock?.expiration && lock.expiration > new Date()) {
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
    hasActiveLock,
    parsedAmount,
    isRelocking,
    CreateLockTxStatus,
    isExtendingDuration,
    isAddingAmount,
    unlockDate,
    lock,
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
    return (
      <div className="flex min-h-4 flex-col gap-4">
        {relockTxStatus === "AWAITING_SIGNATURE" ? (
          <>Continue in wallet</>
        ) : relockTxStatus === "CONFIRMING_APPROVE_TX" ||
          relockTxStatus === "CONFIRMING_RELOCK_TX" ? (
          <>Confirming...</>
        ) : null}
      </div>
    );
  }, [needsApprovalForRelock, parsedAmount, relockTxStatus]);

  // Reset function for dialog
  const resetRelockState = React.useCallback(() => {
    setIsTxDialogOpen(false);
    approve.reset();
    relock.reset();
  }, [approve, relock]);

  return (
    <>
      <Button
        className="w-full"
        disabled={shouldButtonBeDisabled}
        onClick={(e: React.MouseEvent) => {
          handleSubmit(() => {
            if (
              hasActiveLock &&
              lock?.expiration &&
              lock.expiration > new Date()
            ) {
              handleRelock();
            } else {
              createLock();
            }
          })(e);
        }}
        size="lg"
        clipped="default"
        data-testid={buttonLocator}
      >
        {content}
      </Button>

      {/* Transaction Dialog for Relock */}
      <TxDialog
        isOpen={isTxDialogOpen}
        onClose={resetRelockState}
        error={relockTxStatus === "ERROR"}
        title="Top Up Lock"
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
  hasActiveLock,
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
  hasActiveLock: boolean;
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
      if (hasActiveLock && isExtendingDuration) {
        return "extendLockButton";
      }
      return "enterAmountButton";
    }

    // Amount exceeds balance
    if (isBalanceInsufficient) {
      return "insufficientBalanceButton";
    }

    // Has active lock - relock flow
    if (hasActiveLock && lock?.expiration && lock.expiration > new Date()) {
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
    hasActiveLock,
    hasMultipleLocks,
    needsApprovalForRelock,
    isExtendingDuration,
    isAddingAmount,
  ]);
}
