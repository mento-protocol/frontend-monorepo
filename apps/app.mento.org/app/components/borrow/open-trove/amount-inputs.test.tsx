// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  balance: 1_234_567_000_000_000_000n as bigint | undefined,
  collateralPrice: (2n * 10n ** 18n) as bigint | null,
  minDebt: (100n * 10n ** 18n) as bigint | null,
  suggestions: [] as Array<{ amount: bigint; risk: "low" | "medium" | "high" }>,
}));

vi.mock("@mento-protocol/ui", () => ({
  CoinInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => "0xtoken",
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: "0x00000000000000000000000000000000000000aa" }),
  useChainId: () => 42220,
  useReadContract: () => ({ data: mocks.balance }),
}));
vi.mock("@repo/web3", () => ({
  formatCompactBalance: (value: string) => `compact:${value}`,
  formatDebtAmount: (value: bigint) => `${value}:minimum`,
  tryParseUnits: (value: string) =>
    value ? BigInt(Math.round(Number(value) * 1e6)) * 10n ** 12n : null,
  useCollateralPrice: () => ({ data: mocks.collateralPrice }),
  useDebtSuggestions: () => mocks.suggestions,
  useSystemParams: () => ({
    data: mocks.minDebt === null ? undefined : { minDebt: mocks.minDebt },
  }),
}));
vi.mock("../shared/debt-token-selector", () => ({
  TokenDropdown: ({
    value,
    onValueChange,
    disabled,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={() => onValueChange("next")}>
      {value}
    </button>
  ),
}));

import { CollateralInput } from "./collateral-input";
import { DebtInput } from "./debt-input";

const debtToken = {
  symbol: "GBPm",
  locale: "en-US",
  currencyCode: "USD",
} as never;
const options = [{ symbol: "GBPm" }] as never;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    balance: 1_234_567_000_000_000_000n,
    collateralPrice: 2n * 10n ** 18n,
    minDebt: 100n * 10n ** 18n,
    suggestions: [],
  });
});
afterEach(cleanup);

describe("CollateralInput", () => {
  it("changes the amount, token, and maximum value", () => {
    const onChange = vi.fn();
    const onCollateralChange = vi.fn();
    render(
      <CollateralInput
        debtToken={debtToken}
        collateralSymbol="CELO"
        collateralOptions={options}
        value="1"
        onChange={onChange}
        onCollateralChange={onCollateralChange}
      />,
    );
    expect(screen.getByText("≈ $2.00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Collateral amount in CELO"), {
      target: { value: "0.5" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Use max CELO balance" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "CELO" }));
    expect(onChange).toHaveBeenCalledWith("1.2345");
    expect(onCollateralChange).toHaveBeenCalledWith("next");
  });

  it("reports an insufficient balance and handles absent data", () => {
    const { rerender } = render(
      <CollateralInput
        debtToken={debtToken}
        collateralSymbol="CELO"
        collateralOptions={options}
        value="2"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Insufficient CELO balance")).toBeTruthy();
    mocks.balance = undefined;
    mocks.collateralPrice = null;
    rerender(
      <CollateralInput
        debtToken={debtToken}
        collateralSymbol="CELO"
        collateralOptions={options}
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/compact:0/)).toBeTruthy();
  });
});

describe("DebtInput", () => {
  it("shows and selects risk suggestions", () => {
    mocks.suggestions = [
      { amount: 500n * 10n ** 18n, risk: "low" },
      { amount: 5_000n * 10n ** 18n, risk: "medium" },
      { amount: 2_000_000n * 10n ** 18n, risk: "high" },
    ];
    const onChange = vi.fn();
    const onDebtTokenChange = vi.fn();
    render(
      <DebtInput
        debtToken={debtToken}
        debtTokenOptions={options}
        onDebtTokenChange={onDebtTokenChange}
        value="500"
        onChange={onChange}
        collAmount={1n}
      />,
    );
    expect(screen.getByText("500 GBPm")).toBeTruthy();
    expect(screen.getByText("5K GBPm")).toBeTruthy();
    expect(screen.getByText("2.0M GBPm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Moderate/ }));
    fireEvent.click(screen.getByRole("button", { name: "GBPm" }));
    expect(onChange).toHaveBeenCalledWith("5000");
    expect(onDebtTokenChange).toHaveBeenCalledWith("next");
  });

  it("handles no suggestions or minimum debt", () => {
    mocks.minDebt = null;
    const onChange = vi.fn();
    render(
      <DebtInput
        debtToken={debtToken}
        debtTokenOptions={options}
        onDebtTokenChange={vi.fn()}
        value=""
        onChange={onChange}
        collAmount={0n}
      />,
    );
    fireEvent.change(screen.getByLabelText("Borrow amount in GBPm"), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenCalledWith("2");
    expect(screen.queryByText(/^Min:/)).toBeNull();
  });
});
