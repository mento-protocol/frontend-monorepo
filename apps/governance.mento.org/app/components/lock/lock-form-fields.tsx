"use client";
import {
  Checkbox,
  CoinInput,
  Datepicker,
  Input,
  Label,
  Slider,
  useDebounce,
} from "@repo/ui";
import {
  DEFAULT_LOCKING_CLIFF,
  LOCKING_AMOUNT_FORM_KEY,
  LOCKING_DURATION_FORM_KEY,
  LOCKING_DELEGATE_ADDRESS_FORM_KEY,
  LOCKING_DELEGATE_ENABLED_FORM_KEY,
  LOCKING_UNLOCK_DATE_FORM_KEY,
  MAX_LOCKING_DURATION_WEEKS,
  MIN_LOCK_PERIOD_WEEKS,
  isValidAddress,
  useLockCalculation,
  type LockWithExpiration,
} from "@repo/web3";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useFormContext } from "react-hook-form";
import spacetime from "spacetime";
import { formatUnits } from "viem";

interface LockFormFieldsProps {
  mentoBalance: bigint;
  lock?: LockWithExpiration;
  currentAddress?: string;
  amountLabel?: string;
  amountPlaceholder?: string;
  amountInputTestId?: string;
  datePickerTestId?: string;
  onVeMentoCalculated?: (veMento: number, isCalculating: boolean) => void;
}

export function LockFormFields({
  mentoBalance,
  lock,
  currentAddress,
  amountLabel = "MENTO to lock",
  amountPlaceholder = "0",
  amountInputTestId = "lockAmountInput",
  datePickerTestId = "datepickerButton",
  onVeMentoCalculated,
}: LockFormFieldsProps) {
  const existingMethods = useFormContext();
  const localMethods = useForm({
    mode: "onChange",
    defaultValues: {
      [LOCKING_AMOUNT_FORM_KEY]: "",
      [LOCKING_UNLOCK_DATE_FORM_KEY]: undefined as Date | undefined,
      [LOCKING_DELEGATE_ENABLED_FORM_KEY]: false,
      [LOCKING_DELEGATE_ADDRESS_FORM_KEY]: "",
    },
  });

  const methods = existingMethods || localMethods;
  const { register, control, watch, setValue } = methods;
  const delegateEnabled = watch(LOCKING_DELEGATE_ENABLED_FORM_KEY);
  const amountToLock = watch(LOCKING_AMOUNT_FORM_KEY);
  const unlockDate = watch(LOCKING_UNLOCK_DATE_FORM_KEY);

  const [sliderIndex, setSliderIndex] = useState(0);

  const getFirstWednesdayAfterMinPeriod = () => {
    let targetDate = spacetime.now().add(MIN_LOCK_PERIOD_WEEKS, "week");
    while (targetDate.day() !== 3) {
      targetDate = targetDate.add(1, "day");
    }
    return targetDate.toNativeDate();
  };

  const minLockDate = useMemo(() => getFirstWednesdayAfterMinPeriod(), []);

  const validWednesdays = useMemo(() => {
    const wednesdays: Date[] = [];
    const startDate = getFirstWednesdayAfterMinPeriod();
    const maxWeeks = lock
      ? MAX_LOCKING_DURATION_WEEKS - 1
      : MAX_LOCKING_DURATION_WEEKS;

    for (let i = 0; i < maxWeeks; i++) {
      const wednesday = spacetime(startDate).add(i, "week").toNativeDate();
      wednesdays.push(wednesday);
    }
    return wednesdays;
  }, [lock]);

  const maxDate = useMemo(() => {
    return validWednesdays.length > 0
      ? validWednesdays[validWednesdays.length - 1]!
      : spacetime.now().add(MAX_LOCKING_DURATION_WEEKS, "weeks").toNativeDate();
  }, [validWednesdays]);

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

  const isDelegatedToOther = useMemo(() => {
    if (!lock || !currentAddress) return false;
    const me = (currentAddress ?? "").toLowerCase();
    const delegate = (lock.delegate?.id ?? "").toLowerCase();
    return Boolean(delegate) && delegate !== me;
  }, [currentAddress, lock]);

  useEffect(() => {
    if (lock && validWednesdays.length > 0) {
      setValue(LOCKING_AMOUNT_FORM_KEY, "");

      const currentExpiration = lock.expiration;
      const exactIdx = validWednesdays.findIndex(
        (d) => d.getTime() === currentExpiration.getTime(),
      );

      if (exactIdx >= 0) {
        const idx = Math.max(exactIdx, minSelectableIndex);
        setValue(LOCKING_UNLOCK_DATE_FORM_KEY, validWednesdays[idx]);
        setSliderIndex(idx);
      } else {
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

        const idx = Math.max(
          closestIdx >= 0 ? closestIdx : 0,
          minSelectableIndex,
        );
        setValue(LOCKING_UNLOCK_DATE_FORM_KEY, validWednesdays[idx]);
        setSliderIndex(idx);
      }

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
    } else if (!lock && validWednesdays.length > 0) {
      setValue(LOCKING_UNLOCK_DATE_FORM_KEY, validWednesdays[0], {
        shouldValidate: true,
      });
      setSliderIndex(0);
    }
  }, [lock, validWednesdays, setValue, minSelectableIndex, isDelegatedToOther]);

  const currentDateIndex = useMemo(() => {
    if (!unlockDate || validWednesdays.length === 0) return 0;

    const unlockTime = unlockDate.getTime();
    const exactIndex = validWednesdays.findIndex(
      (date) => date.getTime() === unlockTime,
    );

    if (exactIndex >= 0) return exactIndex;

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

  useEffect(() => {
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
    return Math.round(lockDurationInWeeks);
  }, [lockDurationInWeeks]);

  useEffect(() => {
    setValue(LOCKING_DURATION_FORM_KEY, slope as unknown as number, {
      shouldValidate: true,
    });
  }, [slope, setValue]);

  const debouncedAmount = useDebounce(amountToLock || "0", 500);
  const debouncedSlope = useDebounce(slope, 500);

  const { data, isLoading: isCalculating } = useLockCalculation({
    lock: {
      amount: debouncedAmount,
      slope: debouncedSlope,
      cliff: DEFAULT_LOCKING_CLIFF,
    },
  });
  const veMentoReceived = data?.veMentoReceived || 0;

  useEffect(() => {
    onVeMentoCalculated?.(Number(veMentoReceived), isCalculating);
  }, [veMentoReceived, isCalculating, onVeMentoCalculated]);

  const formattedMentoBalance = useMemo(() => {
    return Number(formatUnits(mentoBalance, 18)).toLocaleString();
  }, [mentoBalance]);

  const handleMaxClick = () => {
    setValue(LOCKING_AMOUNT_FORM_KEY, formatUnits(mentoBalance, 18), {
      shouldValidate: true,
    });
  };

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

    const minIdx = minSelectableIndex;
    const maxIdx = validWednesdays.length - 1;
    const midIdx = Math.floor((minIdx + maxIdx) / 2);

    const minDateLabel = validWednesdays[minIdx];
    const midDate = validWednesdays[midIdx];

    const startLabel =
      minIdx >= 0 && minIdx < validWednesdays.length && minDateLabel
        ? formatDuration(minDateLabel)
        : "1 week";
    const middleLabel =
      midIdx >= 0 && midIdx < validWednesdays.length && midDate
        ? formatDuration(midDate)
        : "1 year";

    return { startLabel, middleLabel, endLabel: "2 years" };
  }, [validWednesdays, minSelectableIndex]);

  return (
    <>
      <div className="bg-incard border-border dark:border-input maybe-hover:border-border-secondary focus-within:!border-primary dark:focus-within:!border-primary mb-8 flex grid-cols-12 flex-col items-start gap-4 border p-4 transition-colors md:grid md:min-h-[120px]">
        <div className="col-span-7 flex flex-col gap-2">
          <Label>{amountLabel}</Label>
          <CoinInput
            data-testid={amountInputTestId}
            placeholder={amountPlaceholder}
            {...register(LOCKING_AMOUNT_FORM_KEY, {
              validate: {
                max: (v) =>
                  Number(v) <= Number(formatUnits(mentoBalance, 18)) ||
                  "Insufficient balance",
                min: (v) => {
                  const amount = Number(v);
                  return lock
                    ? amount >= 0 || "Amount must be greater than or equal to 0"
                    : amount > 0 || "Amount must be greater than 0";
                },
              },
            })}
            onChange={(e) => {
              setValue(LOCKING_AMOUNT_FORM_KEY, e.target.value);
            }}
          />
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <span>Balance: {formattedMentoBalance}</span>
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 text-inherit underline"
              onClick={handleMaxClick}
            >
              MAX
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="delegateEnabled"
                checked={isDelegatedToOther ? true : !!delegateEnabled}
                disabled={isDelegatedToOther}
                onCheckedChange={(v) => {
                  if (isDelegatedToOther) return;
                  setValue(LOCKING_DELEGATE_ENABLED_FORM_KEY, Boolean(v), {
                    shouldValidate: true,
                  });
                }}
              />
              <Label htmlFor="delegateEnabled">Delegate</Label>
            </div>

            {(delegateEnabled || isDelegatedToOther) && (
              <Input
                placeholder="Delegate Address..."
                disabled={isDelegatedToOther}
                {...register(LOCKING_DELEGATE_ADDRESS_FORM_KEY, {
                  validate: (val) => {
                    if (!delegateEnabled && !isDelegatedToOther) return true;
                    return isValidAddress(val) || "Invalid address";
                  },
                })}
              />
            )}

            {lock?.delegate?.id && (
              <span className="text-muted-foreground text-xs">
                Currently delegated to:{" "}
                {lock.delegate.id.toLowerCase() ===
                (currentAddress ?? "").toLowerCase()
                  ? "Self"
                  : `${lock.delegate.id.slice(0, 6)}...${lock.delegate.id.slice(-4)}`}
                {isDelegatedToOther && " (locked)"}
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
                data-testid={datePickerTestId}
                value={field.value}
                onChange={field.onChange}
                label="Select date"
                formatter={(date) => date.toLocaleDateString()}
                disabled={isDateDisabled}
                fromDate={minLockDate}
                toDate={maxDate}
                startMonth={minLockDate}
                endMonth={
                  validWednesdays[validWednesdays.length - 1] || maxDate
                }
              />
            )}
          />
        </div>
      </div>

      <div className="mb-8">
        <div className="text-muted-foreground mb-4 flex items-center justify-between text-sm">
          <span>{sliderLabels.startLabel}</span>
          <span className="text-foreground font-medium">
            {lockDurationDisplay}
          </span>
          <span>{sliderLabels.endLabel}</span>
        </div>
        <Slider
          value={[sliderIndex]}
          onValueChange={(value) => {
            const newIndex = value[0];
            if (
              newIndex !== undefined &&
              newIndex >= 0 &&
              newIndex < validWednesdays.length
            ) {
              const clampedIndex = Math.max(newIndex, minSelectableIndex);
              setSliderIndex(clampedIndex);
              setValue(
                LOCKING_UNLOCK_DATE_FORM_KEY,
                validWednesdays[clampedIndex],
                {
                  shouldValidate: true,
                },
              );
            }
          }}
          min={0}
          max={validWednesdays.length - 1}
          step={1}
          className="w-full"
        />
      </div>
    </>
  );
}
