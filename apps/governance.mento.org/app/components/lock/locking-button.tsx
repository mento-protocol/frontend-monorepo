import { LOCKING_AMOUNT_FORM_KEY } from "@/lib/constants/locking";
import { Button, cn } from "@repo/ui";
import React from "react";
import { useFormContext } from "react-hook-form";
import {
  CREATE_LOCK_APPROVAL_STATUS,
  CREATE_LOCK_TX_STATUS,
  useCreateLock,
} from "./create-lock-provider";

export const LockingButton = () => {
  const { createLock, CreateLockTxStatus, CreateLockApprovalStatus } =
    useCreateLock();

  const {
    watch,
    formState: { isValid, errors },
    handleSubmit,
  } = useFormContext();

  const amount = watch(LOCKING_AMOUNT_FORM_KEY);

  const isBalanceInsufficient = errors.amountToLock?.type === "max";

  const content = React.useMemo(() => {
    if (amount === "") {
      return <>Enter Amount</>;
    }
    if (isBalanceInsufficient) {
      return <>Insufficient Balance</>;
    }
    if (CreateLockApprovalStatus === CREATE_LOCK_APPROVAL_STATUS.NOT_APPROVED) {
      return <>Approve MENTO</>;
    }

    return <>Lock MENTO</>;
  }, [CreateLockApprovalStatus, amount, isBalanceInsufficient]);

  const shouldButtonBeDisabled =
    !isValid ||
    isBalanceInsufficient ||
    CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ||
    CreateLockTxStatus === CREATE_LOCK_TX_STATUS.AWAITING_SIGNATURE;

  return (
    <Button
      className={cn(
        "w-full",
        isBalanceInsufficient &&
          "pointer-events-none w-full cursor-not-allowed",
      )}
      disabled={shouldButtonBeDisabled}
      variant={isBalanceInsufficient ? "destructive" : "default"}
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
