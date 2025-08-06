import { toast } from "@repo/ui";
import {
  Alfajores,
  Celo,
  useAllowance,
  useApprove,
  useContracts,
  useLockMento as useCreateLockOnChain,
  useCurrentChain,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import React, { ReactNode, createContext, useContext } from "react";
import { parseEther } from "viem";

import {
  DEFAULT_LOCKING_CLIFF,
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
} from "@repo/web3";
import { differenceInWeeks } from "date-fns";
import { useFormContext } from "react-hook-form";
import { TxDialog } from "../tx-dialog/tx-dialog";

export enum CREATE_LOCK_TX_STATUS {
  PENDING = "PENDING",
  CONFIRMING_LOCK_TX = "CONFIRMING_LOCK_TX",
  CONFIRMING_APPROVE_TX = "CONFIRMING_APPROVE_TX",
  AWAITING_SIGNATURE = "AWAITING_SIGNATURE",
  UNKNOWN = "UNKNOWN",
  ERROR = "ERROR",
}
export enum CREATE_LOCK_APPROVAL_STATUS {
  NOT_APPROVED = "NOT_APPROVED",
  APPROVED = "APPROVED",
  UNKNOWN = "UNKNOWN",
}

export interface ICreateLockContext {
  needsApproval: boolean;
  createLock: () => void;
  reset: () => void;
  retry: () => void;
  approve: ReturnType<typeof useApprove>;
  lock: ReturnType<typeof useCreateLockOnChain>;
  allowance: ReturnType<typeof useAllowance>;
  CreateLockTxStatus: CREATE_LOCK_TX_STATUS;
  CreateLockApprovalStatus: CREATE_LOCK_APPROVAL_STATUS;
}

const CreateLockContext = createContext<ICreateLockContext | undefined>(
  undefined,
);

interface ICreateLockProvider {
  children: ReactNode | ReactNode[];
  onLockConfirmation?: () => void;
}

export const CreateLockProvider = ({
  children,
  onLockConfirmation,
}: ICreateLockProvider) => {
  const { watch, reset: resetForm } = useFormContext();
  const [isTxDialogOpen, setIsTxDialogOpen] = React.useState(false);
  const [hasApprovedForCurrentLock, setHasApprovedForCurrentLock] =
    React.useState(false);

  const { address, chainId } = useAccount();
  const currentChain = useCurrentChain();

  const amount = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);

  const slope = React.useMemo(() => {
    if (!unlockDate) return 0;
    const weeks = differenceInWeeks(unlockDate, new Date()) + 1;
    return weeks;
  }, [unlockDate]);

  const contracts = useContracts();
  const parsedAmount = parseEther(amount);

  const lock = useCreateLockOnChain({
    onLockConfirmation: () => {
      setIsTxDialogOpen(false);
      onLockConfirmation?.();
    },
  });
  const allowance = useAllowance({
    owner: address,
    spender: contracts.Locking.address,
  });

  const resetAll = React.useCallback(() => {
    resetForm();
  }, [resetForm]);

  const lockMento = React.useCallback(() => {
    lock.lockMento({
      account: address!,
      amount: parsedAmount,
      delegate: address!,
      slope,
      cliff: DEFAULT_LOCKING_CLIFF,
      onSuccess: () => {
        resetAll();
      },
      onError: (err) => {
        console.log("lockMento failed", err);
        toast.error("Failed to lock MENTO");
      },
    });
  }, [address, lock, parsedAmount, resetAll, slope]);

  const approve = useApprove();

  const needsApproval = React.useMemo(() => {
    // If we've already approved for this lock transaction, don't recompute based on allowance
    if (hasApprovedForCurrentLock) return false;

    if (!allowance.data) return true;
    return allowance?.data < parsedAmount;
  }, [allowance.data, parsedAmount, hasApprovedForCurrentLock]);

  const CreateLockTxStatus = React.useMemo(() => {
    if (approve.error || lock.error) return CREATE_LOCK_TX_STATUS.ERROR;
    if (approve.isAwaitingUserSignature || lock.isAwaitingUserSignature)
      return CREATE_LOCK_TX_STATUS.AWAITING_SIGNATURE;
    if (approve.isConfirming)
      return CREATE_LOCK_TX_STATUS.CONFIRMING_APPROVE_TX;
    if (lock.isConfirming) return CREATE_LOCK_TX_STATUS.CONFIRMING_LOCK_TX;

    return CREATE_LOCK_TX_STATUS.UNKNOWN;
  }, [
    approve.error,
    approve.isAwaitingUserSignature,
    approve.isConfirming,
    lock.error,
    lock.isAwaitingUserSignature,
    lock.isConfirming,
  ]);

  const CreateLockApprovalStatus = React.useMemo(() => {
    return needsApproval
      ? CREATE_LOCK_APPROVAL_STATUS.NOT_APPROVED
      : CREATE_LOCK_APPROVAL_STATUS.APPROVED;
  }, [needsApproval]);

  const createLock = React.useCallback(() => {
    lock.reset();
    approve.reset();
    setIsTxDialogOpen(true);
    setHasApprovedForCurrentLock(false);

    if (needsApproval) {
      approve.approveMento({
        target: contracts.Locking.address,
        amount: parsedAmount,
        onConfirmation: () => {
          setHasApprovedForCurrentLock(true);
          lockMento();
        },
        onError: (error) => {
          console.error("Approval failed", error);
          toast.error("Failed to approve MENTO");
        },
      });
    } else {
      lockMento();
    }
  }, [
    approve,
    contracts.Locking.address,
    lock,
    lockMento,
    needsApproval,
    parsedAmount,
  ]);

  const reset = React.useCallback(() => {
    setIsTxDialogOpen(false);
    setHasApprovedForCurrentLock(false);
    approve.reset();
    lock.reset();
  }, [approve, lock]);
  const retry = React.useCallback(() => {
    setHasApprovedForCurrentLock(false);
    createLock();
  }, [createLock]);

  // Toast notifications for approval transaction
  React.useEffect(() => {
    if (approve.error) {
      if (approve.error.message?.includes("User rejected request")) {
        toast.error("Approval transaction rejected by user");
      } else {
        toast.error("Approval transaction failed");
      }
    } else if (approve.isConfirmed && approve.hash) {
      const explorerUrl = currentChain.blockExplorers?.default?.url;
      const explorerTxUrl = explorerUrl
        ? `${explorerUrl}/tx/${approve.hash}`
        : null;

      const message = "MENTO approval confirmed! Creating lock...";
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
    }
  }, [approve.error, approve.isConfirmed, approve.hash, chainId]);

  // Toast notifications for lock transaction
  React.useEffect(() => {
    if (lock.error) {
      if (lock.error.message?.includes("User rejected request")) {
        toast.error("Lock transaction rejected by user");
      } else {
        toast.error("Lock transaction failed");
      }
    } else if (lock.isConfirmed && lock.hash) {
      const explorerUrl = currentChain.blockExplorers?.default?.url;
      const explorerTxUrl = explorerUrl
        ? `${explorerUrl}/tx/${lock.hash}`
        : null;

      const message = "MENTO locked successfully!";
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
    }
  }, [lock.error, lock.isConfirmed, lock.hash, chainId]);

  const TxMessage = () => {
    return (
      <div className="flex min-h-4 flex-col gap-4">
        {CreateLockApprovalStatus ===
        CREATE_LOCK_APPROVAL_STATUS.NOT_APPROVED ? (
          <span>Approve MENTO</span>
        ) : (
          <span>Lock MENTO</span>
        )}
        {CreateLockTxStatus === CREATE_LOCK_TX_STATUS.AWAITING_SIGNATURE ? (
          <>Continue in wallet</>
        ) : CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_LOCK_TX ||
          CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ? (
          <>Confirming...</>
        ) : null}
      </div>
    );
  };

  return (
    <CreateLockContext.Provider
      value={{
        reset,
        retry,
        CreateLockTxStatus,
        CreateLockApprovalStatus,
        createLock,
        needsApproval,
        approve,
        lock,
        allowance,
      }}
    >
      {children}
      <TxDialog
        isOpen={isTxDialogOpen}
        onClose={() => {
          setIsTxDialogOpen(false);
          reset();
        }}
        error={CreateLockTxStatus === CREATE_LOCK_TX_STATUS.ERROR}
        title="Create Lock"
        retry={retry}
        message={<TxMessage />}
        preventClose={
          CreateLockTxStatus === CREATE_LOCK_TX_STATUS.AWAITING_SIGNATURE ||
          CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ||
          CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_LOCK_TX
        }
        isPending={
          CreateLockTxStatus === CREATE_LOCK_TX_STATUS.AWAITING_SIGNATURE ||
          CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ||
          CreateLockTxStatus === CREATE_LOCK_TX_STATUS.CONFIRMING_LOCK_TX
        }
      />
    </CreateLockContext.Provider>
  );
};

export function useCreateLock() {
  const context = useContext(CreateLockContext);
  if (context === undefined) {
    throw new Error("useCreateLock must be used within a CreateLockProvider");
  }
  return context;
}
