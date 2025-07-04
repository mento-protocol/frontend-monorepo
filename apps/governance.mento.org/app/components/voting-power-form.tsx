"use client";
import {
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
} from "@/lib/constants/locking";
import useLockCalculation from "@/lib/contracts/locking/useLockCalculation";
import { useLockInfo } from "@/lib/contracts/locking/useLockInfo";
import useTokens from "@/lib/contracts/useTokens";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CoinInput,
  Datepicker,
  Label,
  useDebounce,
} from "@repo/ui";
import { format } from "date-fns";
import { useMemo } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import spacetime from "spacetime";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { CreateLockProvider } from "./lock/create-lock-provider";
import { LockingButton } from "./lock/locking-button";
import { ProgressBar } from "./progress-bar";
import { WithdrawButton } from "./withdraw-button";

export default function VotingPowerForm() {
  const { address } = useAccount();
  const { lock, unlockedMento, hasLock, isLoading } = useLockInfo(address);

  const { veMentoBalance, mentoBalance } = useTokens();

  const tomorrow = useMemo(() => spacetime.tomorrow().toNativeDate(), []);
  const maxDate = useMemo(
    () => spacetime.now().add(2, "years").toNativeDate(),
    [],
  );

  const methods = useForm({
    mode: "onChange",
    defaultValues: {
      [LOCKING_AMOUNT_FORM_KEY]: "",
      [LOCKING_UNLOCK_DATE_FORM_KEY]: tomorrow,
    },
  });

  const { control, watch, register } = methods;

  const amountToLock = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);

  // Calculate duration in months from today to unlock date
  const lockDurationInMonths = useMemo(() => {
    if (!unlockDate) return 0;
    const now = new Date();
    const months =
      (unlockDate.getFullYear() - now.getFullYear()) * 12 +
      (unlockDate.getMonth() - now.getMonth());
    return Math.max(0, months);
  }, [unlockDate]);

  // Calculate slope and cliff for lock calculation
  const slope = useMemo(() => {
    // Convert months to the slope value (assuming 24 months = 104 weeks)
    return Math.round((lockDurationInMonths / 24) * 104);
  }, [lockDurationInMonths]);

  // Debounce inputs for calculation
  const debouncedAmount = useDebounce(amountToLock, 500);
  const debouncedSlope = useDebounce(slope, 500);

  // Calculate veMENTO received
  const {
    data: { veMentoReceived } = { veMentoReceived: 0 },
    isLoading: isCalculating,
  } = useLockCalculation({
    lock: {
      amount: debouncedAmount,
      slope: debouncedSlope,
      cliff: 0, // Default cliff value
    },
  });

  // Format balances
  const formattedMentoBalance = useMemo(() => {
    return Number(formatUnits(mentoBalance.value, 18)).toLocaleString();
  }, [mentoBalance.value]);

  const formattedVeMentoBalance = useMemo(() => {
    return Number(formatUnits(veMentoBalance.value, 18)).toLocaleString();
  }, [veMentoBalance.value]);

  const formattedUnlockedMento = useMemo(() => {
    return Number(unlockedMento).toLocaleString();
  }, [unlockedMento]);

  const formattedVeMentoReceived = useMemo(() => {
    return isCalculating ? "..." : Number(veMentoReceived).toLocaleString();
  }, [veMentoReceived, isCalculating]);

  // Format expiration date
  const expirationDate = useMemo(() => {
    if (!hasLock || !lock?.expiration) return null;
    return format(lock.expiration, "dd.MM.yyyy");
  }, [hasLock, lock]);

  if (isLoading) {
    return <div className="flex items-center justify-center">Loading...</div>;
  }

  if (!address) {
    return (
      <div className="flex items-center justify-center">
        Please connect your wallet to view your voting power
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <CreateLockProvider>
        <div className="flex flex-col gap-8 md:flex-row md:gap-20">
          <Card className="border-border md:max-w-1/2">
            <CardHeader className="text-2xl font-medium">Lock MENTO</CardHeader>
            <CardContent>
              <div className="bg-incard border-border dark:border-input maybe-hover:border-border-secondary focus-within:!border-primary dark:focus-within:!border-primary mb-8 flex grid-cols-12 flex-col gap-4 border p-4 transition-colors md:grid md:h-[120px]">
                <div className="col-span-8 flex flex-col gap-2">
                  <Label>MENTO to lock</Label>
                  <CoinInput
                    data-testid="sellAmountInput"
                    placeholder="0"
                    {...register(LOCKING_AMOUNT_FORM_KEY, {
                      validate: {
                        max: (v) =>
                          Number(v) <=
                            Number(formatUnits(mentoBalance.value, 18)) ||
                          "Insufficient balance",
                      },
                    })}
                  />
                  <span className="text-muted-foreground">
                    Max available: {formattedMentoBalance} MENTO{" "}
                  </span>
                </div>
                <div className="col-span-4 flex flex-row items-center md:flex-col md:items-end md:justify-end">
                  <Controller
                    control={control}
                    name={LOCKING_UNLOCK_DATE_FORM_KEY}
                    render={({ field: { onChange, value } }) => (
                      <Datepicker
                        value={value}
                        onChange={onChange}
                        label="Lock until"
                        formatter={(date) => {
                          return spacetime(date).format("dd.MM.yyyy");
                        }}
                        disabled={{
                          before: tomorrow,
                          after: maxDate,
                        }}
                        startMonth={tomorrow}
                        endMonth={maxDate}
                      />
                    )}
                  />
                </div>
              </div>
              <ProgressBar
                mode="time"
                data={{
                  labels: {
                    start: "1 week",
                    middle: "13 months",
                    end: "2 years",
                  },
                  currentValue: lockDurationInMonths,
                  maxValue: 24,
                  valueLabel: `${formattedVeMentoReceived} veMENTO`,
                }}
              />
              <div className="my-8 flex justify-between text-sm">
                <span className="text-muted-foreground">
                  You receive veMENTO
                </span>
                <span>{formattedVeMentoReceived} veMENTO</span>
              </div>
            </CardContent>
            <CardFooter className="mt-auto">
              <LockingButton />
            </CardFooter>
          </Card>

          {hasLock && (
            <Card className="border-border w-full md:h-[480px] md:min-w-[494px]">
              <CardHeader className="text-2xl font-medium">
                Your existing veMENTO lock
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MENTO</span>
                    <span>{formattedUnlockedMento}</span>
                  </div>
                  <hr className="border-border h-full" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">veMENTO</span>
                    <span>{formattedVeMentoBalance}</span>
                  </div>
                  <hr className="border-border h-full" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span>{expirationDate || "-"}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="mt-auto flex flex-col gap-4">
                <WithdrawButton />
              </CardFooter>
            </Card>
          )}

          {!hasLock && !isLoading && (
            <Card className="border-border flex w-full items-center justify-center md:h-[480px] md:min-w-[494px]">
              <div className="text-muted-foreground text-center">
                You have no existing locks
              </div>
            </Card>
          )}
        </div>
      </CreateLockProvider>
    </FormProvider>
  );
}
