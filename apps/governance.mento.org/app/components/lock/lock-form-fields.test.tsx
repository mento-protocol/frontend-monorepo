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
  Checkbox: () => null,
  CoinInput: React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
    function MockCoinInput(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
  Datepicker: () => null,
  Input: React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
    function MockInput(props, ref) {
      return <input ref={ref} {...props} />;
    },
  ),
  Label: ({ children }: { children: React.ReactNode }) => (
    <label>{children}</label>
  ),
  Slider: () => null,
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

function LockFormHarness({ mentoBalance }: { mentoBalance: bigint }) {
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
      <LockFormFields mentoBalance={mentoBalance} />
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
});
