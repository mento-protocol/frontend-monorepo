import {
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
} from "@/lib/constants/locking";
import { Button, cn, toast } from "@repo/ui";
import React from "react";
import { useFormContext } from "react-hook-form";
import { useAccount } from "wagmi";
import {
  CREATE_LOCK_APPROVAL_STATUS,
  CREATE_LOCK_TX_STATUS,
  useCreateLock,
} from "./create-lock-provider";
import { useLockInfo } from "@/lib/contracts/locking/useLockInfo";
import useRelockMento from "@/lib/contracts/locking/useRelockMento";
import { useAllowance } from "@/lib/contracts/mento/useAllowance";
import useApprove from "@/lib/contracts/mento/useApprove";
import { useContracts } from "@/lib/contracts/useContracts";
import { parseEther } from "viem";
import { TxDialog } from "../tx-dialog/tx-dialog";
import { differenceInWeeks } from "date-fns";
import useLockingWeek from "@/lib/contracts/locking/useLockingWeek";

interface LockingButtonProps {
  hasLock?: boolean;
}

export const LockingButton = ({ hasLock = false }: LockingButtonProps) => {
  const { address } = useAccount();
  const { createLock, CreateLockTxStatus, CreateLockApprovalStatus } =
    useCreateLock();
  const {
    lock,
    hasActiveLock,
    isLockExtendible,
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

  const isBalanceInsufficient = errors[LOCKING_AMOUNT_FORM_KEY]?.type === "max";

  // Calculate new slope for relock
  const newSlope = React.useMemo(() => {
    if (!unlockDate || !lock || !hasActiveLock || !currentLockingWeek) return 0;

    // Safely access lock properties with nullish coalescing
    const lockTime = lock?.time ?? 0;
    const lockSlope = lock?.slope ?? 0;
    const lockExpiration = lock?.expiration;

    if (!lockExpiration) return 0;

    const weeksPassed = Number(currentLockingWeek) - lockTime;
    const weeksAdded = differenceInWeeks(unlockDate, lockExpiration);
    return Math.max(0, lockSlope - weeksPassed + weeksAdded);
  }, [currentLockingWeek, lock, unlockDate, hasActiveLock]);

  // Relock setup
  const relock = useRelockMento({
    lock,
    newSlope,
    additionalAmountToLock: parsedAmount,
    onConfirmation: () => {
      refetchLockInfo();
      resetForm();
      toast.success("Lock updated successfully");
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
          // Success handled in onConfirmation above
          setIsTxDialogOpen(false);
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

  const content = React.useMemo(() => {
    // Wallet not connected
    if (!address) {
      return <>Connect Wallet</>;
    }

    // User has multiple locks
    if (hasMultipleLocks) {
      return <>Multiple locks not supported</>;
    }

    // Amount is null or empty
    if (!amount || amount === "" || amount === "0") {
      return <>Enter amount</>;
    }

    // Amount exceeds balance
    if (isBalanceInsufficient) {
      return <>Insufficient balance</>;
    }

    // Has active lock - relock flow
    if (hasActiveLock && lock?.expiration && lock.expiration > new Date()) {
      // Check if the lock can be extended (only applies when no additional amount)
      if (!isLockExtendible && parsedAmount === BigInt(0)) {
        return <>Lock not extendible yet</>;
      }

      // Approval needed for relock
      if (needsApprovalForRelock) {
        return <>Approve MENTO</>;
      }

      // Check if only extending duration
      if (parsedAmount === BigInt(0)) {
        return <>Extend lock</>;
      }

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
    isLockExtendible,
    needsApprovalForRelock,
    parsedAmount,
  ]);

  const shouldButtonBeDisabled = React.useMemo(() => {
    // Basic checks
    if (
      !address ||
      hasMultipleLocks ||
      !amount ||
      amount === "" ||
      amount === "0" ||
      !isValid ||
      isBalanceInsufficient
    ) {
      return true;
    }

    // Has active lock - relock flow checks
    if (hasActiveLock && lock?.expiration && lock.expiration > new Date()) {
      // Can't extend if not extendible and no additional amount
      if (!isLockExtendible && parsedAmount === BigInt(0)) {
        return true;
      }

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
    isLockExtendible,
    parsedAmount,
    isRelocking,
    CreateLockTxStatus,
  ]);

  // Define relock transaction status
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
        {needsApprovalForRelock ? (
          <span>Approve MENTO</span>
        ) : parsedAmount === BigInt(0) ? (
          <span>Extend Lock</span>
        ) : (
          <span>Top Up Lock</span>
        )}
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
            // Determine if we should create lock or relock
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
      >
        {content}
      </Button>

      {/* Transaction Dialog for Relock */}
      <TxDialog
        isOpen={isTxDialogOpen}
        onClose={resetRelockState}
        error={relockTxStatus === "ERROR"}
        title={parsedAmount === BigInt(0) ? "Extend Lock" : "Top Up Lock"}
        retry={handleRelock}
        message={<TxMessage />}
        dataTestId="relock-tx-dialog"
      />
    </>
  );
};
