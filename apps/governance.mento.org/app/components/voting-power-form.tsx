"use client";
import {
  DEFAULT_LOCKING_CLIFF,
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
  MAX_LOCKING_DURATION_WEEKS,
} from "@/lib/constants/locking";
import useLockCalculation from "@/lib/contracts/locking/useLockCalculation";
import { useLockInfo } from "@/lib/contracts/locking/useLockInfo";
import useTokens from "@/lib/contracts/useTokens";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  cn,
  CoinInput,
  Datepicker,
  IconLoading,
  Label,
  Slider,
  useDebounce,
} from "@repo/ui";
import { format } from "date-fns";
import React, { useMemo } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import spacetime from "spacetime";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { CreateLockProvider } from "./lock/create-lock-provider";
import { LockingButton } from "./lock/locking-button";
import { WithdrawButton } from "./withdraw-button";

export default function VotingPowerForm() {
  const { address } = useAccount();
  const {
    lock,
    unlockedMento,
    hasLock,
    hasActiveLock,
    hasMultipleLocks,
    isLoading,
    refetch,
  } = useLockInfo(address);
  const { veMentoBalance, mentoBalance } = useTokens();

  const MIN_LOCK_PERIOD_WEEKS = 1;

  const getFirstWednesdayAfterMinPeriod = () => {
    let targetDate = spacetime.now().add(MIN_LOCK_PERIOD_WEEKS, "week");

    while (targetDate.day() !== 3) {
      targetDate = targetDate.add(1, "day");
    }

    return targetDate.toNativeDate();
  };

  const minLockDate = useMemo(() => {
    if (hasActiveLock && lock?.expiration) {
      const expirationDate = spacetime(lock.expiration);
      const oneWeekFromNow = spacetime.now().add(MIN_LOCK_PERIOD_WEEKS, "week");

      if (
        expirationDate.isAfter(oneWeekFromNow) &&
        expirationDate.day() === 3
      ) {
        return expirationDate.toNativeDate();
      }

      let targetDate = expirationDate.isAfter(oneWeekFromNow)
        ? expirationDate
        : oneWeekFromNow;

      while (targetDate.day() !== 3) {
        targetDate = targetDate.add(1, "day");
      }

      return targetDate.toNativeDate();
    }

    return getFirstWednesdayAfterMinPeriod();
  }, [hasActiveLock, lock?.expiration]);

  const validWednesdays = useMemo(() => {
    const wednesdays: Date[] = [];
    let currentDate = spacetime(minLockDate);
    const twoYearsFromNow = spacetime.now().add(2, "year");

    while (currentDate.isBefore(twoYearsFromNow)) {
      wednesdays.push(currentDate.toNativeDate());
      currentDate = currentDate.add(1, "week");
    }

    return wednesdays;
  }, [minLockDate]);

  const maxDate = useMemo(
    () =>
      spacetime
        .now()
        .add(MAX_LOCKING_DURATION_WEEKS / 52, "years")
        .toNativeDate(),
    [],
  );

  const isDateDisabled = (date: Date) => {
    const isBeforeMin = date < minLockDate;
    const isAfterMax = date > maxDate;
    const isNotWednesday = spacetime(date).day() !== 3;
    return isBeforeMin || isAfterMax || isNotWednesday;
  };

  const methods = useForm({
    mode: "onChange",
    defaultValues: {
      [LOCKING_AMOUNT_FORM_KEY]: "",
      [LOCKING_UNLOCK_DATE_FORM_KEY]:
        validWednesdays.length > 0 ? validWednesdays[0] : minLockDate,
    },
  });

  const { control, watch, register, setValue } = methods;

  React.useEffect(() => {
    if (validWednesdays.length > 0) {
      const defaultDate = validWednesdays[0];
      setValue(LOCKING_UNLOCK_DATE_FORM_KEY, defaultDate);
    }
  }, [validWednesdays, setValue]);

  const amountToLock = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);

  const currentDateIndex = useMemo(() => {
    if (!unlockDate || validWednesdays.length === 0) return 0;

    const unlockTime = unlockDate.getTime();
    let closestIndex = 0;
    let minDiff = Math.abs(validWednesdays[0].getTime() - unlockTime);

    for (let i = 1; i < validWednesdays.length; i++) {
      const diff = Math.abs(validWednesdays[i].getTime() - unlockTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    return closestIndex;
  }, [unlockDate, validWednesdays]);

  const { lockDurationInWeeks, lockDurationDisplay } = useMemo(() => {
    if (!unlockDate)
      return {
        lockDurationInWeeks: 0,
        lockDurationDisplay: "0 weeks",
      };

    const now = new Date();
    const timeDiff = unlockDate.getTime() - now.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    const weeksDiff = Math.ceil(daysDiff / 7);

    // Calculate months more accurately
    const yearsDiff = unlockDate.getFullYear() - now.getFullYear();
    const monthsDiff = unlockDate.getMonth() - now.getMonth();
    const totalMonths = yearsDiff * 12 + monthsDiff;

    // Adjust for day of month differences
    const adjustedMonths =
      unlockDate.getDate() >= now.getDate() ? totalMonths : totalMonths - 1;

    // Helper function for pluralization
    const pluralize = (count: number, singular: string, plural: string) => {
      return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
    };

    // Display logic: show weeks if less than 2 months, otherwise show months
    const lockDurationDisplay =
      adjustedMonths < 1
        ? pluralize(weeksDiff, "week", "weeks")
        : pluralize(adjustedMonths, "month", "months");

    return {
      lockDurationInWeeks: weeksDiff,
      lockDurationDisplay,
    };
  }, [unlockDate]);

  // Calculate slope and cliff for lock calculation
  const slope = useMemo(() => {
    // Convert months to the slope value (assuming 24 months = 104 weeks)
    return Math.round(lockDurationInWeeks);
  }, [lockDurationInWeeks]);

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
      cliff: DEFAULT_LOCKING_CLIFF,
    },
  });

  // Format balances
  const formattedMentoBalance = useMemo(() => {
    return Number(formatUnits(mentoBalance.value, 18)).toLocaleString();
  }, [mentoBalance.value]);

  const formattedVeMentoBalance = useMemo(() => {
    return Number(formatUnits(veMentoBalance.value, 18)).toLocaleString();
  }, [veMentoBalance.value]);

  const formattedLock = useMemo(() => {
    return lock?.amount
      ? Number(formatUnits(lock.amount, 18)).toLocaleString()
      : "0";
  }, [lock?.amount]);

  const formattedUnlockedMento = useMemo(() => {
    return Number(unlockedMento).toLocaleString();
  }, [unlockedMento]);

  const formattedVeMentoReceived = useMemo(() => {
    return isCalculating ? "..." : Number(veMentoReceived).toLocaleString();
  }, [veMentoReceived, isCalculating]);

  // Format expiration date
  const expirationDate = useMemo(() => {
    if (!hasLock) return null;
    if (!lock?.expiration) return null;

    // Check if lock has expired (expiration date is in the past)
    const now = new Date();
    if (lock.expiration < now) {
      return "Fully unlocked";
    }

    return format(lock.expiration, "dd.MM.yyyy");
  }, [hasLock, lock]);

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
          <Card className="border-border xl:max-w-1/2 w-full lg:min-w-[420px] lg:max-w-[420px]">
            <CardHeader className="text-2xl font-medium">Lock MENTO</CardHeader>
            <CardContent>
              <div className="bg-incard border-border dark:border-input maybe-hover:border-border-secondary focus-within:!border-primary dark:focus-within:!border-primary mb-8 flex grid-cols-12 flex-col items-start gap-4 border p-4 transition-colors md:grid md:min-h-[120px]">
                <div className="col-span-7 flex flex-col gap-2">
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
                <div className="col-span-5 flex flex-row items-center md:flex-col md:items-end md:justify-end">
                  <Controller
                    control={control}
                    name={LOCKING_UNLOCK_DATE_FORM_KEY}
                    render={({ field: { onChange, value } }) => (
                      <Datepicker
                        className="w-full"
                        value={value}
                        onChange={onChange}
                        label="Lock until"
                        formatter={(date) => {
                          return spacetime(date).format("dd.MM.yyyy");
                        }}
                        disabled={isDateDisabled}
                        fromDate={minLockDate}
                        toDate={maxDate}
                        startMonth={value || minLockDate}
                        endMonth={maxDate}
                      />
                    )}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-muted-foreground flex justify-between text-sm">
                  <span>Lock Duration</span>
                  <span className="text-foreground font-medium">
                    {lockDurationDisplay}
                  </span>
                </div>
                <Slider
                  value={[currentDateIndex]}
                  onValueChange={(values) => {
                    const newIndex = values[0];
                    if (newIndex >= 0 && newIndex < validWednesdays.length) {
                      setValue(
                        LOCKING_UNLOCK_DATE_FORM_KEY,
                        validWednesdays[newIndex],
                        { shouldValidate: true },
                      );
                    }
                  }}
                  min={0}
                  max={validWednesdays.length - 1}
                  step={1}
                  className="my-4"
                />
                <div className="text-muted-foreground flex justify-between text-xs">
                  <span>1 week</span>
                  <span>1 year</span>
                  <span>2 years</span>
                </div>
              </div>
              <div className="mb-2 mt-8 flex justify-between text-sm">
                <span className="text-muted-foreground">
                  You receive veMENTO
                </span>
                <span>{formattedVeMentoReceived} veMENTO</span>
              </div>
            </CardContent>
            <CardFooter className="mt-auto">
              <LockingButton hasLock={hasActiveLock} />
            </CardFooter>
          </Card>

          <Card className="border-border w-full md:h-[480px] md:min-w-[494px]">
            <CardHeader className="text-2xl font-medium">
              Your existing veMENTO lock
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
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">veMENTO</span>
                      <span>{formattedVeMentoBalance}</span>
                    </div>
                    <hr className="border-border h-full" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Locked MENTO
                      </span>
                      <span>{formattedLock}</span>
                    </div>
                    <hr className="border-border h-full" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Withdrawable MENTO
                      </span>
                      <span>{formattedUnlockedMento}</span>
                    </div>
                    <hr className="border-border h-full" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expires</span>
                      <span>{expirationDate || "-"}</span>
                    </div>
                    {hasMultipleLocks && (
                      <>
                        <hr className="border-border h-full" />
                        <div className="text-muted-foreground text-sm">
                          <span className="font-medium">Note:</span> You have
                          multiple locks. We're displaying your first lock. You
                          can add more MENTO to this lock or extend its
                          duration.
                        </div>
                      </>
                    )}
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
