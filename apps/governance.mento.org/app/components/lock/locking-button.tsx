import { LOCKING_AMOUNT_FORM_KEY } from "@/lib/constants/locking";
import { Button, cn } from "@repo/ui";
import React from "react";
import { useFormContext } from "react-hook-form";
import { useAccount } from "wagmi";
import {
  CREATE_LOCK_APPROVAL_STATUS,
  CREATE_LOCK_TX_STATUS,
  useCreateLock,
} from "./create-lock-provider";

interface LockingButtonProps {
  hasLock?: boolean;
}

export const LockingButton = ({ hasLock = false }: LockingButtonProps) => {
  const { address } = useAccount();
  const { createLock, CreateLockTxStatus, CreateLockApprovalStatus } =
    useCreateLock();

  const {
    watch,
    formState: { isValid, errors },
    handleSubmit,
  } = useFormContext();

  const amount = watch(LOCKING_AMOUNT_FORM_KEY);

  const isBalanceInsufficient = errors[LOCKING_AMOUNT_FORM_KEY]?.type === "max";

  const content = React.useMemo(() => {
    // Wallet not connected
    if (!address) {
      return <>Connect Wallet</>;
    }

    // User already has a lock
    if (hasLock) {
      return <>Already locked</>;
    }

    // Amount is null or empty
    if (!amount || amount === "" || amount === "0") {
      return <>Enter amount</>;
    }

    // Amount exceeds balance
    if (isBalanceInsufficient) {
      return <>Insufficient balance</>;
    }

    // Approval needed
    if (CreateLockApprovalStatus === CREATE_LOCK_APPROVAL_STATUS.NOT_APPROVED) {
      return <>Approve MENTO</>;
    }

    return <>Lock MENTO</>;
  }, [
    address,
    amount,
    isBalanceInsufficient,
    CreateLockApprovalStatus,
    hasLock,
  ]);

  const shouldButtonBeDisabled =
    !address ||
    hasLock ||
    !amount ||
    amount === "" ||
    amount === "0" ||
    !isValid ||
    isBalanceInsufficient ||
    CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ||
    CreateLockTxStatus === CREATE_LOCK_TX_STATUS.AWAITING_SIGNATURE;

  return (
    <Button
      className="w-full"
      disabled={shouldButtonBeDisabled}
      onClick={(e: React.MouseEvent) => {
        handleSubmit(() => {
          createLock();
        })(e);
      }}
      size="lg"
      clipped="default"
    >
      {content}
    </Button>
  );
};
