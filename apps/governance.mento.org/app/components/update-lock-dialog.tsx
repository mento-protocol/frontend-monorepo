"use client";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/ui";
import { useTokens } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { CreateLockProvider } from "./lock/create-lock-provider";
import { LockFormFields } from "./lock/lock-form-fields";
import { LockingButton } from "./lock/locking-button";
import { LockWithExpiration } from "@/contracts/types";

interface UpdateLockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lock: LockWithExpiration;
  onLockUpdated?: () => void;
}

export function UpdateLockDialog({
  open,
  onOpenChange,
  lock,
  onLockUpdated,
}: UpdateLockDialogProps) {
  const { address } = useAccount();
  const { mentoBalance } = useTokens();

  const methods = useForm();
  const [veMentoReceived, setVeMentoReceived] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);

  const formattedVeMentoReceived = useMemo(() => {
    return isCalculating ? "..." : veMentoReceived.toLocaleString();
  }, [veMentoReceived, isCalculating]);

  const handleLockUpdated = () => {
    onLockUpdated?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-start text-3xl">
            Update Lock #{lock.lockId}
          </DialogTitle>
        </DialogHeader>

        <FormProvider {...methods}>
          <CreateLockProvider onLockConfirmation={handleLockUpdated}>
            <LockFormFields
              mentoBalance={mentoBalance.value}
              lock={lock}
              currentAddress={address}
              amountLabel="MENTO to add to the lock"
              amountPlaceholder="0"
              amountInputTestId="updateLockAmountInput"
              onVeMentoCalculated={(veMento, isCalculating) => {
                setVeMentoReceived(veMento);
                setIsCalculating(isCalculating);
              }}
            />

            <div className="mb-2 flex justify-between text-sm">
              <span className="text-muted-foreground">You receive veMENTO</span>
              <span data-testid="updateLockVeMentoReceiveLabel">
                {formattedVeMentoReceived} veMENTO
              </span>
            </div>
            <div className="flex gap-5">
              <DialogClose asChild>
                <Button variant="abstain" className="h-12 flex-1" clipped="lg">
                  Cancel
                </Button>
              </DialogClose>
              <LockingButton
                lockToUpdate={lock}
                className="w-fit flex-1"
                onLockUpdated={handleLockUpdated}
              />
            </div>
          </CreateLockProvider>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
