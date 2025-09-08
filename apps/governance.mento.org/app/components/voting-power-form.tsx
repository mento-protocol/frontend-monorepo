"use client";
import {
  DEFAULT_LOCKING_CLIFF,
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
  MAX_LOCKING_DURATION_WEEKS,
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

export default function VotingPowerForm() {
  const { address } = useAccount();
  const {
    lock,
    lockedBalance,
    unlockedMento,
    hasLock,
    hasActiveLock,
    isLoading,
    refetch,
  } = useLockInfo(address);

  const { veMentoBalance, mentoBalance } = useTokens();
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

  // When topping up an existing lock, find the first selectable Wednesday index
  const minSelectableIndex = useMemo(() => {
    if (!hasActiveLock || !lock?.expiration || validWednesdays.length === 0) {
      return 0;
    }

    const expirationTime = new Date(lock.expiration).getTime();
    const idx = validWednesdays.findIndex(
      (date) => date.getTime() >= expirationTime,
    );
    // If no valid Wednesday is found after expiration, return last index
    return idx >= 0 ? idx : validWednesdays.length - 1;
  }, [hasActiveLock, lock?.expiration, validWednesdays]);

  const maxDate = useMemo(() => {
    // Use the last valid Wednesday as the max date to ensure consistency
    return validWednesdays.length > 0
      ? validWednesdays[validWednesdays.length - 1]
      : spacetime.now().add(MAX_LOCKING_DURATION_WEEKS, "weeks").toNativeDate();
  }, [validWednesdays]);

  const sliderLabels = useMemo(() => {
    const formatDuration = (targetDate: Date, forceMonths = false) => {
      const now = new Date();
      const timeDiff = targetDate.getTime() - now.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
      const weeksDiff = Math.ceil(daysDiff / 7);

      // Use the same calendar-month logic as lockDurationDisplay
      const yearsDiff = targetDate.getFullYear() - now.getFullYear();
      const monthsDiff = targetDate.getMonth() - now.getMonth();
      const totalMonths = yearsDiff * 12 + monthsDiff;
      const adjustedMonths =
        targetDate.getDate() >= now.getDate() ? totalMonths : totalMonths - 1;

      // Helper function for pluralization
      const pluralize = (count: number, singular: string, plural: string) => {
        return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
      };

      // Display logic: show weeks if less than 1 month, otherwise show months
      if (forceMonths || adjustedMonths >= 1) {
        return pluralize(adjustedMonths, "month", "months");
      }
      return pluralize(weeksDiff, "week", "weeks");
    };

    const minIdx = hasActiveLock && lock?.expiration ? minSelectableIndex : 0;
    const maxIdx = validWednesdays.length - 1;
    const midIdx = Math.floor((minIdx + maxIdx) / 2);

    const minDate = validWednesdays[minIdx];
    const midDate = validWednesdays[midIdx];

    // Calculate start label
    const startLabel = (() => {
      if (minIdx >= 0 && minIdx < validWednesdays.length && minDate) {
        return formatDuration(minDate, hasActiveLock && !!lock?.expiration);
      }
      return "1 week";
    })();

    // Calculate middle label
    const middleLabel = (() => {
      if (midIdx >= 0 && midIdx < validWednesdays.length && midDate) {
        return formatDuration(midDate, hasActiveLock && !!lock?.expiration);
      }
      return "1 year";
    })();

    return { startLabel, middleLabel, endLabel: "2 years" };
  }, [validWednesdays, hasActiveLock, lock?.expiration, minSelectableIndex]);

  const isDateDisabled = (date: Date) => {
    if (!maxDate) throw new Error("maxDate is undefined");
    const isBeforeMin = date < minLockDate;
    const isAfterMax = date > maxDate;
    const isNotWednesday = spacetime(date).day() !== 3;

    // When topping up an existing lock, you cannot choose a date before the
    // current expiration.
    const isBeforeCurrentExpiration =
      hasActiveLock && lock?.expiration
        ? date < new Date(lock.expiration)
        : false;

    return (
      isBeforeMin || isAfterMax || isNotWednesday || isBeforeCurrentExpiration
    );
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
    if (validWednesdays.length === 0) {
      return;
    }

    let defaultDate = validWednesdays[0];

    if (hasActiveLock && lock?.expiration) {
      const expirationTime = lock.expiration.getTime();

      const exactIdx = validWednesdays.findIndex(
        (d) => d.getTime() === expirationTime,
      );
      if (exactIdx >= 0) {
        defaultDate = validWednesdays[exactIdx];
      } else {
        defaultDate = validWednesdays.reduce((prev, curr) => {
          if (!prev) throw new Error("prev is undefined");
          return Math.abs(curr.getTime() - expirationTime) <
            Math.abs(prev.getTime() - expirationTime)
            ? curr
            : prev;
        }, validWednesdays[0]);
      }
    }

    if (!defaultDate) throw new Error("defaultDate is undefined");

    setValue(LOCKING_UNLOCK_DATE_FORM_KEY, defaultDate, {
      shouldValidate: true,
    });
    const idx = validWednesdays.findIndex(
      (d) => d.getTime() === defaultDate.getTime(),
    );
    if (idx >= 0) {
      setSliderIndex(idx);
    }
  }, [validWednesdays, hasActiveLock, lock?.expiration, setValue]);

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

  const formattedVeMentoBalance = useMemo(() => {
    return Number(formatUnits(veMentoBalance.value, 18)).toLocaleString();
  }, [veMentoBalance.value]);

  const formattedLock = useMemo(() => {
    return Number(lockedBalance).toLocaleString();
  }, [lockedBalance]);

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

    return lock.expiration.toLocaleDateString();
  }, [hasLock, lock]);

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
                          // Allow empty or 0 amount if user has active lock and is extending duration
                          if (
                            (!v || v === "" || amount === 0) &&
                            hasActiveLock &&
                            unlockDate &&
                            lock?.expiration
                          ) {
                            const currentExpiration = new Date(lock.expiration);
                            const selectedDate = new Date(unlockDate);
                            return (
                              selectedDate.getTime() !==
                                currentExpiration.getTime() ||
                              "Select a different unlock date to extend your lock"
                            );
                          }
                          return amount >= 0 || "Amount must be positive";
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
                    // Enforce minimum selectable index for existing locks
                    const actualIndex =
                      hasActiveLock && lock?.expiration
                        ? Math.max(newIndex, minSelectableIndex)
                        : newIndex;

                    setSliderIndex(actualIndex);
                    if (
                      actualIndex >= 0 &&
                      actualIndex < validWednesdays.length
                    ) {
                      setValue(
                        LOCKING_UNLOCK_DATE_FORM_KEY,
                        validWednesdays[actualIndex],
                        { shouldValidate: true },
                      );
                    }
                  }}
                  min={
                    hasActiveLock && lock?.expiration ? minSelectableIndex : 0
                  }
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
