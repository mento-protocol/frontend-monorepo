"use client";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  IconLoading,
} from "@repo/ui";
import {
  useAvailableToWithdraw,
  useLockInfo,
  useLocksByAccount,
  useTokens,
  useLockedAmount,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import React, { useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { formatUnits } from "viem";
import { CreateLockProvider } from "./lock/create-lock-provider";
import { LockFormFields } from "./lock/lock-form-fields";
import { LockingButton } from "./lock/locking-button";
import { WithdrawButton } from "./withdraw-button";
import { useVeMentoDelegationSummary } from "../hooks/use-ve-mento-delegation-summary";

export default function VotingPowerForm() {
  const { address } = useAccount();
  const { isLoading, refetch } = useLockInfo(address);

  const { mentoBalance, veMentoBalance } = useTokens();
  const { locks } = useLocksByAccount({ account: address! });

  // Get on-chain withdrawable principal
  const { availableToWithdraw } = useAvailableToWithdraw();
  // Get on-chain currently locked principal from Locking.locked(address)
  const { data: lockedAmount = 0n } = useLockedAmount();

  // Use shared hook to compute delegated and received veMENTO totals
  const { delegatedOutVe, receivedVe } = useVeMentoDelegationSummary({
    locks,
    address,
  });

  // Calculate lock type totals with correct semantics
  const summary = useMemo(() => {
    if (!locks || !address) {
      return {
        lockedMento: 0,
        ownVe: 0,
        receivedVe: 0,
        delegatedOutVe: 0,
        totalVe: 0,
        withdrawableMento: 0,
      };
    }

    // 2) Total ve = wallet balanceOf (current effective voting power)
    const totalVe = Number(formatUnits(veMentoBalance.value, 18));

    // 3) Received ve from hook
    const received = receivedVe;

    // 4) Own ve = total minus received
    const ownVe = Math.max(0, totalVe - received);

    // 5) Delegated out ve = veMENTO from my locks that are delegated to others
    // 5) Delegated out ve from hook
    const delegated = delegatedOutVe;

    // 6) Withdrawable principal from contract (keeps button and summary in sync)
    const withdrawableMento = Number(
      formatUnits(availableToWithdraw ?? 0n, 18),
    );

    return {
      lockedMento: Number(formatUnits(lockedAmount, 18)),
      ownVe,
      receivedVe: received,
      delegatedOutVe: delegated,
      totalVe,
      withdrawableMento,
    };
  }, [
    locks,
    address,
    veMentoBalance.value,
    availableToWithdraw,
    lockedAmount,
    delegatedOutVe,
    receivedVe,
  ]);

  const methods = useForm();

  // Format summary values for display
  const formattedLockedMento = useMemo(() => {
    return summary.lockedMento.toLocaleString();
  }, [summary.lockedMento]);

  const formattedTotalVeMento = useMemo(() => {
    return summary.totalVe.toLocaleString();
  }, [summary.totalVe]);

  // State for veMENTO display
  const [veMentoReceived, setVeMentoReceived] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);

  const formattedVeMentoReceived = useMemo(() => {
    return isCalculating ? "..." : veMentoReceived.toLocaleString();
  }, [veMentoReceived, isCalculating]);

  if (!address) {
    return (
      <div className="flex items-center justify-center">
        Please connect your wallet to view your voting power
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <CreateLockProvider onLockConfirmation={refetch}>
        <div className="flex flex-col gap-8 md:gap-20 lg:flex-row">
          <Card className="border-border w-full lg:min-w-[420px] lg:max-w-[420px] xl:max-w-[60%]">
            <CardHeader className="text-2xl font-medium">Lock MENTO</CardHeader>
            <CardContent>
              <LockFormFields
                mentoBalance={mentoBalance.value}
                currentAddress={address}
                amountLabel="MENTO to lock"
                amountPlaceholder="0"
                amountInputTestId="lockAmountInput"
                datePickerTestId="datepickerButton"
                onVeMentoCalculated={(veMento, isCalculating) => {
                  setVeMentoReceived(veMento);
                  setIsCalculating(isCalculating);
                }}
              />
              <div className="mb-2 mt-8 flex justify-between text-sm">
                <span className="text-muted-foreground">
                  You receive veMENTO
                </span>
                <span data-testid="veMentoReceiveLabel">
                  {formattedVeMentoReceived} veMENTO
                </span>
              </div>
            </CardContent>
            <CardFooter className="mt-auto">
              <LockingButton />
            </CardFooter>
          </Card>

          <Card className="border-border w-full md:h-[480px] md:min-w-[494px] xl:max-w-[40%]">
            <CardHeader className="text-2xl font-medium">
              Locks Summary
            </CardHeader>
            <>
              <CardContent
                className={cn(
                  isLoading && "flex h-full items-center justify-center",
                )}
              >
                {isLoading && <IconLoading />}
                {!isLoading && (
                  <div className="flex flex-col gap-4">
                    {/* Locked MENTO */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Locked MENTO
                      </span>
                      <span data-testid="totalLockedMentoLabel">
                        {formattedLockedMento}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* veMENTO from your own locks */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        veMENTO from your own locks
                      </span>
                      <span data-testid="ownLocksVeMentoLabel">
                        {summary.ownVe.toLocaleString()}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* Delegated veMENTO */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          Delegated veMENTO
                        </span>
                      </div>
                      <span data-testid="delegatedVeMentoLabel">
                        {summary.delegatedOutVe.toLocaleString()}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* Received veMENTO */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          Received veMENTO
                        </span>
                      </div>
                      <span data-testid="receivedVeMentoLabel">
                        {summary.receivedVe.toLocaleString()}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* Total veMENTO */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Total veMENTO
                      </span>
                      <span data-testid="totalVeMentoLabel">
                        {formattedTotalVeMento}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* Withdrawable MENTO */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Withdrawable MENTO
                      </span>
                      <span data-testid="withdrawableMentoLabel">
                        {summary.withdrawableMento.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className="mt-auto flex flex-col gap-4">
                <WithdrawButton />
              </CardFooter>
            </>
          </Card>
        </div>
      </CreateLockProvider>
    </FormProvider>
  );
}
