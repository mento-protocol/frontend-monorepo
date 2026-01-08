import { useApprove, useLockMento as useCreateLockOnChain } from "@/contracts";
import { useCurrentChain } from "@/hooks/use-current-chain";
import { toast } from "@repo/ui";
import { LockingABI, useContracts } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import React, { ReactNode, createContext, useContext } from "react";
import { Address, parseEther } from "viem";
import { useReadContract } from "@repo/web3/wagmi";

import {
  DEFAULT_LOCKING_CLIFF,
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_DELEGATE_ADDRESS_FORM_KEY,
  LOCKING_DELEGATE_ENABLED_FORM_KEY,
  LOCKING_DURATION_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
} from "@/contracts/locking";
import { isValidAddress } from "@repo/web3";
import { differenceInWeeks } from "date-fns";
import { useFormContext } from "react-hook-form";
import { TxDialog } from "../tx-dialog/tx-dialog";

export enum LOCK_TX_STATUS {
  CONFIRMING_LOCK_TX = "CONFIRMING_LOCK_TX",
  CONFIRMING_APPROVE_TX = "CONFIRMING_APPROVE_TX",
  CONFIRMING_RELOCK_TX = "CONFIRMING_RELOCK_TX",
  AWAITING_SIGNATURE = "AWAITING_SIGNATURE",
  UNKNOWN = "UNKNOWN",
  ERROR = "ERROR",
}
export enum CREATE_LOCK_APPROVAL_STATUS {
  NOT_APPROVED = "NOT_APPROVED",
  APPROVED = "APPROVED",
  UNKNOWN = "UNKNOWN",
}

interface ICreateLockContext {
  needsApproval: boolean;
  createLock: () => void;
  reset: () => void;
  retry: () => void;
  approve: ReturnType<typeof useApprove>;
  lock: ReturnType<typeof useCreateLockOnChain>;
  CreateLockTxStatus: LOCK_TX_STATUS;
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
  const [createLockError, setCreateLockError] = React.useState(false);
  const [hasApprovedForCurrentLock, setHasApprovedForCurrentLock] =
    React.useState(false);

  const { address, chainId } = useAccount();
  const currentChain = useCurrentChain();

  const amount = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);
  const delegateEnabled = watch(LOCKING_DELEGATE_ENABLED_FORM_KEY);
  const delegateAddressInput = watch(LOCKING_DELEGATE_ADDRESS_FORM_KEY);

  const slopeFromForm = watch(LOCKING_DURATION_FORM_KEY) as number | undefined;
  const slope = React.useMemo(() => {
    if (typeof slopeFromForm === "number" && !Number.isNaN(slopeFromForm)) {
      return Math.max(0, Math.floor(slopeFromForm));
    }
    if (!unlockDate) return 0;
    const weeks = differenceInWeeks(unlockDate, new Date()) + 1;
    return Math.max(0, weeks);
  }, [slopeFromForm, unlockDate]);

  const contracts = useContracts();
  const { data: minSlopePeriodBn } = useReadContract({
    address: contracts.Locking.address,
    abi: LockingABI,
    functionName: "minSlopePeriod",
    args: [],
  });
  const { data: minCliffPeriodBn } = useReadContract({
    address: contracts.Locking.address,
    abi: LockingABI,
    functionName: "minCliffPeriod",
    args: [],
  });
  const minSlopePeriod = React.useMemo(
    () => Number(minSlopePeriodBn ?? 0n),
    [minSlopePeriodBn],
  );
  const minCliffPeriod = React.useMemo(
    () => Number(minCliffPeriodBn ?? 0n),
    [minCliffPeriodBn],
  );

  const parsedAmount = React.useMemo(() => {
    try {
      const normalized = (amount ?? "0").trim();
      if (normalized === "" || normalized === "0") return BigInt(0);
      const parsed = parseEther(normalized);
      // Ensure parsed amount is either 0 or >= 1 MENTO to prevent invalid transactions
      const minAmount = parseEther("1");
      if (parsed > 0n && parsed < minAmount) {
        return BigInt(0); // Invalid amount that rounds below minimum
      }
      return parsed;
    } catch {
      return BigInt(0);
    }
  }, [amount]);

  const lock = useCreateLockOnChain({
    onLockConfirmation: () => {
      setIsTxDialogOpen(false);
      onLockConfirmation?.();
    },
  });

  const resetAll = React.useCallback(() => {
    resetForm();
  }, [resetForm]);

  const selectedDelegate: Address = React.useMemo(() => {
    if (
      delegateEnabled &&
      delegateAddressInput &&
      isValidAddress(delegateAddressInput)
    ) {
      return delegateAddressInput;
    }
    return address!;
  }, [address, delegateAddressInput, delegateEnabled]);

  const lockMento = React.useCallback(() => {
    const effectiveSlope = Math.max(slope, minSlopePeriod);
    const effectiveCliff = Math.max(DEFAULT_LOCKING_CLIFF, minCliffPeriod);

    lock.lockMento({
      account: address!,
      amount: parsedAmount,
      delegate: selectedDelegate,
      slope: effectiveSlope,
      cliff: effectiveCliff,
      onSuccess: () => {
        resetAll();
      },
      onError: (error) => {
        console.error("Lock failed", error);
        toast.error("Failed to create lock");
        setCreateLockError(true);
      },
    });
  }, [
    address,
    lock,
    parsedAmount,
    resetAll,
    selectedDelegate,
    slope,
    minSlopePeriod,
    minCliffPeriod,
  ]);

  const approve = useApprove();

  const needsApproval = React.useMemo(() => {
    // Always require approval when locking tokens
    return parsedAmount > BigInt(0);
  }, [parsedAmount]);

  const CreateLockTxStatus = React.useMemo(() => {
    if (createLockError || approve.error || lock.error)
      return LOCK_TX_STATUS.ERROR;
    if (approve.isAwaitingUserSignature || lock.isAwaitingUserSignature)
      return LOCK_TX_STATUS.AWAITING_SIGNATURE;
    if (approve.isConfirming) return LOCK_TX_STATUS.CONFIRMING_APPROVE_TX;
    if (lock.isConfirming) return LOCK_TX_STATUS.CONFIRMING_LOCK_TX;

    return LOCK_TX_STATUS.UNKNOWN;
  }, [
    createLockError,
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
    // Require an unlock date before proceeding
    if (!unlockDate) {
      toast.error("Please select a lock end date");
      return;
    }
    lock.reset();
    approve.reset();
    setIsTxDialogOpen(true);
    setCreateLockError(false);
    setHasApprovedForCurrentLock(false);

    // Always require approval when locking tokens
    if (parsedAmount > BigInt(0)) {
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
          setCreateLockError(true);
        },
      });
    } else {
      // Should not reach here in normal flow
      lockMento();
    }
  }, [
    approve,
    contracts.Locking.address,
    lock,
    lockMento,
    parsedAmount,
    unlockDate,
  ]);

  const reset = React.useCallback(() => {
    setIsTxDialogOpen(false);
    setCreateLockError(false);
    setHasApprovedForCurrentLock(false);
    approve.reset();
    lock.reset();
  }, [approve, lock]);
  const retry = React.useCallback(() => {
    setCreateLockError(false);
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
  }, [
    approve.error,
    approve.isConfirmed,
    approve.hash,
    chainId,
    currentChain.blockExplorers?.default?.url,
  ]);

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
  }, [
    lock.error,
    lock.isConfirmed,
    lock.hash,
    chainId,
    currentChain.blockExplorers?.default?.url,
  ]);

  const TxMessage = () => {
    const isApprovalPhase =
      (approve.isAwaitingUserSignature || approve.isConfirming) &&
      !hasApprovedForCurrentLock;

    return (
      <div className="flex min-h-4 flex-col gap-4">
        {isApprovalPhase ? <span>Approve MENTO</span> : <span>Lock MENTO</span>}
        {CreateLockTxStatus === LOCK_TX_STATUS.AWAITING_SIGNATURE ? (
          <>Continue in wallet</>
        ) : CreateLockTxStatus === LOCK_TX_STATUS.CONFIRMING_LOCK_TX ||
          CreateLockTxStatus === LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ? (
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
      }}
    >
      {children}
      <TxDialog
        isOpen={isTxDialogOpen}
        onClose={() => {
          setIsTxDialogOpen(false);
          reset();
        }}
        error={CreateLockTxStatus === LOCK_TX_STATUS.ERROR}
        title="Create Lock"
        retry={retry}
        message={<TxMessage />}
        preventClose={
          CreateLockTxStatus === LOCK_TX_STATUS.AWAITING_SIGNATURE ||
          CreateLockTxStatus === LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ||
          CreateLockTxStatus === LOCK_TX_STATUS.CONFIRMING_LOCK_TX
        }
        isPending={
          CreateLockTxStatus === LOCK_TX_STATUS.AWAITING_SIGNATURE ||
          CreateLockTxStatus === LOCK_TX_STATUS.CONFIRMING_APPROVE_TX ||
          CreateLockTxStatus === LOCK_TX_STATUS.CONFIRMING_LOCK_TX
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
