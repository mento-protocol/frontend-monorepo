"use client";
import {
  Button,
  CoinInput,
  Datepicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  Slider,
  useDebounce,
  Checkbox,
  Input,
} from "@repo/ui";
import type { LockWithExpiration } from "@repo/web3";
import {
  DEFAULT_LOCKING_CLIFF,
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
  MAX_LOCKING_DURATION_WEEKS,
  useLockCalculation,
  useTokens,
  LOCKING_DELEGATE_ENABLED_FORM_KEY,
  LOCKING_DELEGATE_ADDRESS_FORM_KEY,
  isValidAddress,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { useEffect, useMemo, useState } from "react";
import { Controller, FormProvider, useForm } from "react-hook-form";
import spacetime from "spacetime";
import { formatUnits } from "viem";
import { CreateLockProvider } from "./lock/create-lock-provider";
import { LockingButton } from "./lock/locking-button";

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
  const { veMentoBalance, mentoBalance } = useTokens();

  const MIN_LOCK_PERIOD_WEEKS = 1;

  const getFirstWednesdayAfterMinPeriod = () => {
    let targetDate = spacetime.now().add(MIN_LOCK_PERIOD_WEEKS, "week");

    while (targetDate.day() !== 3) {
      targetDate = targetDate.add(1, "day");
    }

    return targetDate.toNativeDate();
  };

  const validWednesdays = useMemo(() => {
    const wednesdays: Date[] = [];
    const startDate = getFirstWednesdayAfterMinPeriod();

    for (let i = 0; i < MAX_LOCKING_DURATION_WEEKS; i++) {
      const wednesday = spacetime(startDate).add(i, "week").toNativeDate();
      wednesdays.push(wednesday);
    }

    return wednesdays;
  }, []);

  // Determine the earliest selectable index based on the current lock expiration
  const minSelectableIndex = useMemo(() => {
    if (!lock?.expiration || validWednesdays.length === 0) return 0;
    const expirationTime = lock.expiration.getTime();
    const idx = validWednesdays.findIndex(
      (date) => date.getTime() >= expirationTime,
    );
    return idx >= 0 ? idx : validWednesdays.length - 1;
  }, [lock?.expiration, validWednesdays]);

  const isDateDisabled = (date: Date) => {
    if (validWednesdays.length === 0) return true;
    const minDate = validWednesdays[0]!;
    const maxDate = validWednesdays[validWednesdays.length - 1]!;

    const isBeforeMin = date < minDate;
    const isAfterMax = date > maxDate;
    const isNotWednesday = spacetime(date).day() !== 3;
    const isBeforeCurrentExpiration = lock?.expiration
      ? date < new Date(lock.expiration)
      : false;

    return (
      isBeforeMin || isAfterMax || isNotWednesday || isBeforeCurrentExpiration
    );
  };

  const methods = useForm({
    defaultValues: {
      [LOCKING_AMOUNT_FORM_KEY]: "",
      [LOCKING_UNLOCK_DATE_FORM_KEY]: validWednesdays[0],
      [LOCKING_DELEGATE_ENABLED_FORM_KEY]: false,
      [LOCKING_DELEGATE_ADDRESS_FORM_KEY]: "",
    },
  });

  const { register, watch, setValue, control } = methods;
  const delegateEnabled = watch(LOCKING_DELEGATE_ENABLED_FORM_KEY);

  // If this lock is delegated to someone other than the connected user,
  // we must keep delegation enabled and the delegate address fixed.
  const isDelegatedToOther = useMemo(() => {
    const me = (address ?? "").toLowerCase();
    const delegate = (lock?.delegate?.id ?? "").toLowerCase();
    return Boolean(delegate) && delegate !== me;
  }, [address, lock?.delegate?.id]);

  // Pre-populate form with current lock data
  useEffect(() => {
    if (lock && open) {
      // Set current lock amount (empty for extension only)
      setValue(LOCKING_AMOUNT_FORM_KEY, "");

      // Set current expiration date
      const currentExpiration = lock.expiration;
      const exactIdx = validWednesdays.findIndex(
        (d) => d.getTime() === currentExpiration.getTime(),
      );

      if (exactIdx >= 0) {
        // Ensure slider index is not before the minimum selectable index
        const idx = Math.max(exactIdx, minSelectableIndex);
        setValue(LOCKING_UNLOCK_DATE_FORM_KEY, validWednesdays[idx]);
        setSliderIndex(idx);
      } else {
        // Find closest valid Wednesday
        const closestWednesday = validWednesdays.reduce((prev, curr) => {
          if (!prev) return curr;
          return Math.abs(curr.getTime() - currentExpiration.getTime()) <
            Math.abs(prev.getTime() - currentExpiration.getTime())
            ? curr
            : prev;
        }, validWednesdays[0]);

        const closestIdx = closestWednesday
          ? validWednesdays.findIndex(
              (d) => d.getTime() === closestWednesday.getTime(),
            )
          : -1;

        // Enforce minimum selectable index
        const idx = Math.max(
          closestIdx >= 0 ? closestIdx : 0,
          minSelectableIndex,
        );
        setValue(LOCKING_UNLOCK_DATE_FORM_KEY, validWednesdays[idx]);
        setSliderIndex(idx);
      }

      // If delegated to another address, preset and lock delegation controls
      if (isDelegatedToOther) {
        setValue(LOCKING_DELEGATE_ENABLED_FORM_KEY, true, {
          shouldValidate: true,
        });
        if (lock?.delegate?.id) {
          setValue(LOCKING_DELEGATE_ADDRESS_FORM_KEY, lock.delegate.id, {
            shouldValidate: true,
          });
        }
      }
    }
  }, [
    lock,
    open,
    validWednesdays,
    setValue,
    minSelectableIndex,
    isDelegatedToOther,
  ]);

  const amountToLock = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);

  const currentDateIndex = useMemo(() => {
    if (!unlockDate || validWednesdays.length === 0) return 0;

    const unlockTime = unlockDate.getTime();
    const exactIndex = validWednesdays.findIndex(
      (date) => date.getTime() === unlockTime,
    );

    if (exactIndex >= 0) {
      return exactIndex;
    }

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

  const [sliderIndex, setSliderIndex] = useState(0);

  useEffect(() => {
    // Keep slider index within selectable bounds
    setSliderIndex((prev) => {
      const next = Math.max(currentDateIndex, minSelectableIndex);
      return next !== prev ? next : prev;
    });
  }, [currentDateIndex, minSelectableIndex]);

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

    const yearsDiff = unlockDate.getFullYear() - now.getFullYear();
    const monthsDiff = unlockDate.getMonth() - now.getMonth();
    const totalMonths = yearsDiff * 12 + monthsDiff;

    const adjustedMonths =
      unlockDate.getDate() >= now.getDate() ? totalMonths : totalMonths - 1;

    const pluralize = (count: number, singular: string, plural: string) => {
      return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
    };

    const lockDurationDisplay =
      adjustedMonths < 1
        ? pluralize(weeksDiff, "week", "weeks")
        : pluralize(adjustedMonths, "month", "months");

    return {
      lockDurationInWeeks: weeksDiff,
      lockDurationDisplay,
    };
  }, [unlockDate]);

  const slope = useMemo(() => {
    // Convert months to the slope value (assuming 24 months = 104 weeks)
    return Math.round(lockDurationInWeeks);
  }, [lockDurationInWeeks]);

  // Debounce inputs for calculation
  const debouncedAmount = useDebounce(amountToLock, 500);
  const debouncedSlope = useDebounce(slope, 500);

  const {
    data,
    isLoading: isCalculating,
    error: calculationError,
  } = useLockCalculation({
    lock: {
      amount: debouncedAmount,
      slope: debouncedSlope,
      cliff: DEFAULT_LOCKING_CLIFF,
    },
  });
  const veMentoReceived = data?.veMentoReceived || 0;

  console.log("LOG", {
    lock,
    veMentoReceived,
    isCalculating,
    calculationError,
  });

  const formattedVeMentoReceived = useMemo(() => {
    return isCalculating ? "..." : Number(veMentoReceived).toLocaleString();
  }, [veMentoReceived, isCalculating]);

  const handleUseMaxBalance = () => {
    setValue(LOCKING_AMOUNT_FORM_KEY, formatUnits(mentoBalance.value, 18));
  };

  const handleLockUpdated = () => {
    onLockUpdated?.();
    onOpenChange(false);
  };

  if (!address) {
    return null;
  }

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
            <div className="bg-incard border-border dark:border-input maybe-hover:border-border-secondary focus-within:!border-primary dark:focus-within:!border-primary mb-8 flex grid-cols-12 flex-col items-start gap-4 border p-4 transition-colors md:grid md:min-h-[120px]">
              <div className="col-span-7 flex flex-col gap-2">
                <Label>MENTO to lock</Label>
                <CoinInput
                  data-testid="updateLockAmountInput"
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
                <span className="text-muted-foreground text-xs">
                  Max available:{" "}
                  {Number(formatUnits(mentoBalance.value, 18)).toLocaleString()}{" "}
                  MENTO
                </span>
                {/* Delegate controls */}
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="updateDelegateEnabled"
                      checked={isDelegatedToOther ? true : !!delegateEnabled}
                      disabled={isDelegatedToOther}
                      onCheckedChange={(v) => {
                        if (isDelegatedToOther) return;
                        setValue(
                          LOCKING_DELEGATE_ENABLED_FORM_KEY,
                          Boolean(v),
                          {
                            shouldValidate: true,
                          },
                        );
                      }}
                    />
                    <Label htmlFor="updateDelegateEnabled">Delegate</Label>
                  </div>
                  <Input
                    placeholder="Delegate Address..."
                    disabled={!delegateEnabled || isDelegatedToOther}
                    {...register(LOCKING_DELEGATE_ADDRESS_FORM_KEY, {
                      validate: (val) => {
                        if (!delegateEnabled) return true;
                        return isValidAddress(val) || "Invalid address";
                      },
                    })}
                  />
                  {lock?.delegate?.id && (
                    <span className="text-muted-foreground text-xs">
                      Currently delegated to:{" "}
                      {lock.delegate.id.toLowerCase() ===
                      (address ?? "").toLowerCase()
                        ? "Self"
                        : `${lock.delegate.id.slice(0, 6)}...${lock.delegate.id.slice(-4)}`}
                      {isDelegatedToOther && " (preset)"}
                    </span>
                  )}
                </div>
              </div>
              <div className="col-span-5 flex flex-col items-end justify-end gap-2">
                <Label>Lock until</Label>
                <Controller
                  control={control}
                  name={LOCKING_UNLOCK_DATE_FORM_KEY}
                  render={({ field }) => (
                    <Datepicker
                      value={field.value}
                      onChange={field.onChange}
                      label="Select date"
                      formatter={(date) => date.toLocaleDateString()}
                      disabled={isDateDisabled}
                      fromDate={validWednesdays[0]}
                      toDate={validWednesdays[validWednesdays.length - 1]}
                      startMonth={validWednesdays[0]}
                      endMonth={validWednesdays[validWednesdays.length - 1]}
                    />
                  )}
                />
              </div>
            </div>

            <div className="mb-8">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-muted-foreground text-sm">1 week</span>
                <span className="text-muted-foreground text-sm">
                  {lockDurationDisplay}
                </span>
                <span className="text-muted-foreground text-sm">2 years</span>
              </div>
              <Slider
                value={[sliderIndex]}
                onValueChange={(value) => {
                  const newIndex = value[0];
                  if (newIndex !== undefined) {
                    const clampedIndex = Math.max(newIndex, minSelectableIndex);
                    if (validWednesdays[clampedIndex]) {
                      setSliderIndex(clampedIndex);
                      setValue(
                        LOCKING_UNLOCK_DATE_FORM_KEY,
                        validWednesdays[clampedIndex],
                        {
                          shouldValidate: true,
                        },
                      );
                    }
                  }
                }}
                min={minSelectableIndex}
                max={validWednesdays.length - 1}
                step={1}
                className="w-full"
              />
              <div className="mt-4 text-center">
                <span className="text-lg font-semibold">
                  {formattedVeMentoReceived} veMENTO
                </span>
              </div>
            </div>

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
