import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/ui", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
  CoinInput: React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
    function MockCoinInput(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
  Datepicker: ({
    value,
    onChange,
    formatter,
    disabled,
    fromDate,
    toDate,
  }: {
    value?: Date;
    onChange: (date: Date) => void;
    formatter: (date: Date) => string;
    disabled: (date: Date) => boolean;
    fromDate: Date;
    toDate: Date;
  }) => (
    <div>
      <span>{value ? formatter(value) : "no date"}</span>
      <button type="button" onClick={() => onChange(fromDate)}>
        pick date
      </button>
      <span data-testid="dateChecks">
        {String(disabled(new Date("2020-01-01")))}:
        {String(disabled(new Date("2035-01-01")))}:{String(disabled(toDate))}
      </span>
    </div>
  ),
  Input: React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
    function MockInput(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
  Label: ({ children }: { children: React.ReactNode }) => (
    <label>{children}</label>
  ),
  Slider: ({ onValueChange }: { onValueChange: (value: number[]) => void }) => (
    <div>
      <button type="button" onClick={() => onValueChange([2])}>
        move slider
      </button>
      <button type="button" onClick={() => onValueChange([])}>
        empty slider
      </button>
    </div>
  ),
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("@repo/web3", () => ({
  isValidAddress: () => true,
}));

vi.mock("@/contracts/locking", () => ({
  DEFAULT_LOCKING_CLIFF: 0,
  LOCKING_AMOUNT_FORM_KEY: "amount",
  LOCKING_DELEGATE_ADDRESS_FORM_KEY: "delegateAddress",
  LOCKING_DELEGATE_ENABLED_FORM_KEY: "delegateEnabled",
  LOCKING_DURATION_FORM_KEY: "duration",
  LOCKING_UNLOCK_DATE_FORM_KEY: "unlockDate",
  MAX_LOCKING_DURATION_WEEKS: 104,
  MIN_LOCK_PERIOD_WEEKS: 1,
  useLockCalculation: () => ({ data: undefined, isLoading: false }),
}));

import {
  LockFormFields,
  validateAmountWithinBalance,
} from "./lock-form-fields";

const MENTO_DECIMALS = 10n ** 18n;

function AmountError() {
  const {
    formState: { errors },
  } = useFormContext();

  return (
    <output data-testid="amountError">{`${errors.amount?.message ?? ""}`}</output>
  );
}

function LockFormHarness({
  mentoBalance,
  lock,
  currentAddress,
  onVeMentoCalculated,
}: {
  mentoBalance: bigint;
  lock?: never;
  currentAddress?: string;
  onVeMentoCalculated?: (value: number, loading: boolean) => void;
}) {
  const methods = useForm({
    mode: "onChange",
    defaultValues: {
      amount: "",
      delegateAddress: "",
      delegateEnabled: false,
      duration: 0,
      unlockDate: "",
    },
  });

  return (
    <FormProvider {...methods}>
      <LockFormFields
        mentoBalance={mentoBalance}
        lock={lock}
        currentAddress={currentAddress}
        onVeMentoCalculated={onVeMentoCalculated}
      />
      <AmountError />
    </FormProvider>
  );
}

describe("LockFormFields balance validation", () => {
  afterEach(() => {
    cleanup();
  });

  it("revalidates the existing amount when the MENTO balance changes", async () => {
    const { rerender } = render(<LockFormHarness mentoBalance={0n} />);
    const amountInput = screen.getByTestId(
      "lockAmountInput",
    ) as HTMLInputElement;

    await act(async () => {});

    fireEvent.change(amountInput, { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getByTestId("amountError").textContent).toBe(
        "Insufficient balance",
      );
    });

    rerender(<LockFormHarness mentoBalance={2n * MENTO_DECIMALS} />);

    await waitFor(() => {
      expect(screen.getByTestId("amountError").textContent).toBe("");
    });
    expect(screen.getByTestId("lockAmountInput")).toBe(amountInput);
    expect(amountInput.value).toBe("1");

    rerender(<LockFormHarness mentoBalance={0n} />);

    await waitFor(() => {
      expect(screen.getByTestId("amountError").textContent).toBe(
        "Insufficient balance",
      );
    });
    expect(amountInput.value).toBe("1");
  });

  it("accepts an unset amount and rejects an amount above the balance", () => {
    const balance = 2n * MENTO_DECIMALS;

    expect(validateAmountWithinBalance(undefined, balance)).toBe(true);
    expect(validateAmountWithinBalance(null, balance)).toBe(true);
    expect(validateAmountWithinBalance("", balance)).toBe(true);
    expect(validateAmountWithinBalance("invalid", balance)).toBe(true);
    expect(validateAmountWithinBalance("1", MENTO_DECIMALS)).toBe(true);
    expect(validateAmountWithinBalance("3", balance)).toBe(
      "Insufficient balance",
    );
    expect(
      validateAmountWithinBalance("1.000000000000000001", MENTO_DECIMALS),
    ).toBe("Insufficient balance");
  });

  it("supports max, delegation, dates, sliders, and an imperative focus", async () => {
    const onCalculated = vi.fn();
    const ref = React.createRef<{ focusAmountInput: () => void }>();
    function Harness() {
      const methods = useForm({
        defaultValues: {
          amount: "",
          delegateAddress: "",
          delegateEnabled: false,
          duration: 0,
          unlockDate: "",
        },
      });
      return (
        <FormProvider {...methods}>
          <LockFormFields
            ref={ref}
            mentoBalance={2n * MENTO_DECIMALS}
            onVeMentoCalculated={onCalculated}
          />
        </FormProvider>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(
      (screen.getByTestId("lockAmountInput") as HTMLInputElement).value,
    ).toBe("2");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByTestId("delegateAddressInput"), {
      target: { value: "0xabc-!?" },
    });
    expect(
      (screen.getByTestId("delegateAddressInput") as HTMLInputElement).value,
    ).toBe("0xabc");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "pick date" }));
    fireEvent.click(screen.getByRole("button", { name: "move slider" }));
    fireEvent.click(screen.getByRole("button", { name: "empty slider" }));
    act(() => ref.current?.focusAmountInput());
    expect(document.activeElement).toBe(screen.getByTestId("lockAmountInput"));
    expect(onCalculated).toHaveBeenCalled();
  });

  it("initializes an existing delegated lock", async () => {
    const lock = {
      expiration: new Date("2027-01-06T00:00:00Z"),
      slope: 10,
      delegate: { id: "0x00000000000000000000000000000000000000bb" },
    } as never;
    render(
      <LockFormHarness
        mentoBalance={2n * MENTO_DECIMALS}
        lock={lock}
        currentAddress="0x00000000000000000000000000000000000000aa"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("delegateAddressInput")).toBeTruthy(),
    );
    expect(screen.getByText(/Currently delegated to/)).toBeTruthy();
    expect(screen.getByTestId("dateChecks").textContent).toContain("true");
  });
});
