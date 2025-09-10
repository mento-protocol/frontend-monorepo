"use client";
import {
  DEFAULT_LOCKING_CLIFF,
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
  MAX_LOCKING_DURATION_WEEKS,
  LOCKING_DELEGATE_ENABLED_FORM_KEY,
  LOCKING_DELEGATE_ADDRESS_FORM_KEY,
} from "@repo/web3";
import { useLockCalculation } from "@repo/web3";
import { useLockInfo } from "@repo/web3";
import { useTokens } from "@repo/web3";
import { useLocksByAccount } from "@repo/web3";
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
  Checkbox,
  Input,
  Slider,
  useDebounce,
} from "@repo/ui";
import React, { useEffect, useMemo, useState } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import spacetime from "spacetime";
import { formatUnits } from "viem";
import { useAccount } from "@repo/web3/wagmi";
import { CreateLockProvider } from "./lock/create-lock-provider";
import { LockingButton } from "./lock/locking-button";
import { WithdrawButton } from "./withdraw-button";
import { isValidAddress } from "@repo/web3";

export default function VotingPowerForm() {
  const { address } = useAccount();
  const { isLoading, refetch } = useLockInfo(address);

  const { mentoBalance } = useTokens();
  const { locks } = useLocksByAccount({ account: address! });

  // Calculate lock type totals
  const lockTotals = useMemo(() => {
    if (!locks || !address) {
      return {
        totalLockedMento: 0,
        ownLocksVeMento: 0,
        delegatedVeMento: 0,
        totalVeMento: 0,
        withdrawableMento: 0,
      };
    }

    let totalLockedMento = 0;
    let ownLocksVeMento = 0;
    let delegatedVeMento = 0;
    let withdrawableMento = 0;

    locks.forEach((lock) => {
      const isOwner = lock.owner.id.toLowerCase() === address.toLowerCase();
      const isDelegatedToSelf =
        lock.delegate.id.toLowerCase() === address.toLowerCase();
      const amount = Number(formatUnits(BigInt(lock.amount), 18));

      if (isOwner) {
        totalLockedMento += amount;

        if (isDelegatedToSelf) {
          // Personal locks - user owns and delegates to self
          ownLocksVeMento += amount; // Simplified: using amount as veMento for now
        }

        // Check if withdrawable (expired)
        const now = new Date();
        if (now > lock.expiration) {
          withdrawableMento += amount;
        }
      } else if (isDelegatedToSelf) {
        // Received delegations - user receives delegation from others
        delegatedVeMento += amount; // Simplified: using amount as veMento for now
      }
    });

    const totalVeMento = ownLocksVeMento + delegatedVeMento;

    return {
      totalLockedMento,
      ownLocksVeMento,
      delegatedVeMento,
      totalVeMento,
      withdrawableMento,
    };
  }, [locks, address]);

  const MIN_LOCK_PERIOD_WEEKS = 1;

  const getFirstWednesdayAfterMinPeriod = () => {
    let targetDate = spacetime.now().add(MIN_LOCK_PERIOD_WEEKS, "week");

    while (targetDate.day() !== 3) {
      targetDate = targetDate.add(1, "day");
    }

    return targetDate.toNativeDate();
  };

  // Base minimum is always the first Wednesday at least one week from now.
  const baseMinLockDate = useMemo(() => getFirstWednesdayAfterMinPeriod(), []);

  // For convenience we keep the previous name but it now always points to the
  // base minimum.  Selection rules for active locks are handled separately via
  // `isDateDisabled` so that the slider can still render earlier weeks for
  // display purposes but the user will not be able to select them when a lock
  // already exists.
  const minLockDate = baseMinLockDate;

  const validWednesdays = useMemo(() => {
    const wednesdays: Date[] = [];
    let currentDate = spacetime(minLockDate);
    const maxLockingDate = spacetime
      .now()
      .add(MAX_LOCKING_DURATION_WEEKS, "weeks");

    while (
      currentDate.isBefore(maxLockingDate) ||
      currentDate.isSame(maxLockingDate, "day")
    ) {
      wednesdays.push(currentDate.toNativeDate());
      currentDate = currentDate.add(1, "week");
    }

    return wednesdays;
  }, [minLockDate]);

  // Always creating a new lock: no special minimum beyond base min date
  // (Slider min index stays at 0; earlier dates are disabled by minLockDate)

  const maxDate = useMemo(() => {
    // Use the last valid Wednesday as the max date to ensure consistency
    return validWednesdays.length > 0
      ? validWednesdays[validWednesdays.length - 1]
      : spacetime.now().add(MAX_LOCKING_DURATION_WEEKS, "weeks").toNativeDate();
  }, [validWednesdays]);

  const sliderLabels = useMemo(() => {
    const formatDuration = (targetDate: Date) => {
      const now = new Date();
      const timeDiff = targetDate.getTime() - now.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      const weeksDiff = Math.ceil(daysDiff / 7);

      const yearsDiff = targetDate.getFullYear() - now.getFullYear();
      const monthsDiff = targetDate.getMonth() - now.getMonth();
      const totalMonths = yearsDiff * 12 + monthsDiff;
      const adjustedMonths =
        targetDate.getDate() >= now.getDate() ? totalMonths : totalMonths - 1;

      const pluralize = (count: number, singular: string, plural: string) =>
        count === 1 ? `${count} ${singular}` : `${count} ${plural}`;

      return adjustedMonths >= 1
        ? pluralize(adjustedMonths, "month", "months")
        : pluralize(weeksDiff, "week", "weeks");
    };

    const minIdx = 0;
    const maxIdx = validWednesdays.length - 1;
    const midIdx = Math.floor((minIdx + maxIdx) / 2);

    const minDate = validWednesdays[minIdx];
    const midDate = validWednesdays[midIdx];

    const startLabel =
      minIdx >= 0 && minIdx < validWednesdays.length && minDate
        ? formatDuration(minDate)
        : "1 week";
    const middleLabel =
      midIdx >= 0 && midIdx < validWednesdays.length && midDate
        ? formatDuration(midDate)
        : "1 year";

    return { startLabel, middleLabel, endLabel: "2 years" };
  }, [validWednesdays]);

  const isDateDisabled = (date: Date) => {
    if (!maxDate) throw new Error("maxDate is undefined");
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
      [LOCKING_DELEGATE_ENABLED_FORM_KEY]: false,
      [LOCKING_DELEGATE_ADDRESS_FORM_KEY]: "",
    },
  });

  const { control, watch, register, setValue } = methods;
  const delegateEnabled = watch(LOCKING_DELEGATE_ENABLED_FORM_KEY);
  const delegateAddress = watch(LOCKING_DELEGATE_ADDRESS_FORM_KEY);

  React.useEffect(() => {
    if (validWednesdays.length === 0) return;
    const defaultDate = validWednesdays[0];
    setValue(LOCKING_UNLOCK_DATE_FORM_KEY, defaultDate, {
      shouldValidate: true,
    });
    setSliderIndex(0);
  }, [validWednesdays, setValue]);

  const amountToLock = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);

  const currentDateIndex = useMemo(() => {
    if (!unlockDate || validWednesdays.length === 0) return 0;

    const unlockTime = unlockDate.getTime();

    // First, try to find an exact match
    const exactIndex = validWednesdays.findIndex(
      (date) => date.getTime() === unlockTime,
    );

    if (exactIndex >= 0) {
      return exactIndex;
    }

    // If no exact match, find the closest one
    let closestIndex = 0;
    let minDiff = Math.abs(validWednesdays[0]!.getTime() - unlockTime);

    for (let i = 1; i < validWednesdays.length; i++) {
      const diff = Math.abs(validWednesdays[i]!.getTime() - unlockTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    return closestIndex;
  }, [unlockDate, validWednesdays]);

  // State to control slider value explicitly
  const [sliderIndex, setSliderIndex] = useState(0);

  // Sync slider index with calculated currentDateIndex
  useEffect(() => {
    setSliderIndex(currentDateIndex);
  }, [currentDateIndex]);

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

  const formattedVeMentoReceived = useMemo(() => {
    return isCalculating ? "..." : Number(veMentoReceived).toLocaleString();
  }, [veMentoReceived, isCalculating]);

  // No longer relying on current active lock in this form; always creating a new lock.

  const handleUseMaxBalance = () => {
    methods.setValue(
      LOCKING_AMOUNT_FORM_KEY,
      formatUnits(mentoBalance.value, 18),
    );
  };

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
                        min: (v) => {
                          const amount = Number(v);
                          return amount > 0 || "Amount must be greater than 0";
                        },
                      },
                    })}
                  />
                  <div className="text-muted-foreground flex items-center gap-1">
                    <span>Balance: {formattedMentoBalance}</span>
                    <button
                      type="button"
                      className="cursor-pointer border-none bg-transparent p-0 text-inherit underline"
                      onClick={handleUseMaxBalance}
                    >
                      MAX
                    </button>
                  </div>
                  {/* Delegate controls */}
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="delegateEnabled"
                        checked={!!delegateEnabled}
                        onCheckedChange={(v) =>
                          setValue(
                            LOCKING_DELEGATE_ENABLED_FORM_KEY,
                            Boolean(v),
                            { shouldValidate: true },
                          )
                        }
                      />
                      <Label htmlFor="delegateEnabled">Delegate</Label>
                    </div>
                    <Input
                      placeholder="Delegate Address..."
                      disabled={!delegateEnabled}
                      {...register(LOCKING_DELEGATE_ADDRESS_FORM_KEY, {
                        validate: (v) => {
                          if (!delegateEnabled) return true;
                          return isValidAddress(v) || "Invalid address";
                        },
                      })}
                    />
                  </div>
                </div>
                <div className="col-span-5 flex flex-row items-center md:flex-col md:items-end md:justify-end">
                  <Controller
                    control={control}
                    name={LOCKING_UNLOCK_DATE_FORM_KEY}
                    render={({ field: { onChange, value } }) => (
                      <Datepicker
                        dataTestId="datepickerButton"
                        className="w-full"
                        value={value}
                        onChange={onChange}
                        label="Lock until"
                        formatter={(date) => {
                          return date.toLocaleDateString();
                        }}
                        disabled={isDateDisabled}
                        fromDate={minLockDate}
                        toDate={maxDate}
                        startMonth={minLockDate}
                        endMonth={
                          validWednesdays.length > 0
                            ? validWednesdays[validWednesdays.length - 1]
                            : maxDate
                        }
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
                  key="lock-duration-slider"
                  value={[sliderIndex]}
                  onValueChange={(values) => {
                    const newIndex = values[0]!;
                    setSliderIndex(newIndex);
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
                  <span>{sliderLabels.startLabel}</span>
                  <span>{sliderLabels.middleLabel}</span>
                  <span>{sliderLabels.endLabel}</span>
                </div>
              </div>
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

          <Card className="border-border w-full md:h-[480px] md:min-w-[494px]">
            <CardHeader className="text-2xl font-medium">
              veMENTO locks summary
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
                        {lockTotals.totalLockedMento.toLocaleString()}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* veMENTO from your own locks */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        veMENTO from your own locks
                      </span>
                      <span data-testid="ownLocksVeMentoLabel">
                        {lockTotals.ownLocksVeMento.toLocaleString()}
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
                        {lockTotals.delegatedVeMento.toLocaleString()}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* Total veMENTO */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Total veMENTO
                      </span>
                      <span data-testid="totalVeMentoLabel">
                        {lockTotals.totalVeMento.toLocaleString()}
                      </span>
                    </div>
                    <hr className="border-border" />

                    {/* Withdrawable MENTO */}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Withdrawable MENTO
                      </span>
                      <span data-testid="withdrawableMentoLabel">
                        {lockTotals.withdrawableMento.toLocaleString()}
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
