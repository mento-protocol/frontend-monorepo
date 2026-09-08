// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  connected: true,
  fee: 10n as bigint | null | undefined,
  feeError: false,
  feeFetching: false,
  minRate: (1n * 10n ** 16n) as bigint | null,
  mutate: vi.fn(),
  pending: false,
}));

vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => {
    void _size;
    return <button {...props}>{children}</button>;
  },
  Slider: ({ onValueChange }: { onValueChange: (value: number[]) => void }) => (
    <div>
      <button onClick={() => onValueChange([7.5])}>set slider</button>
      <button onClick={() => onValueChange([])}>empty slider</button>
    </div>
  ),
}));
vi.mock("../shared/risk-badge", () => ({
  RiskBadge: ({ risk }: { risk: string }) => <span>{risk} risk</span>,
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address, isConnected: mocks.connected }),
  useConfig: () => ({ config: true }),
}));
vi.mock("@repo/web3", () => ({
  useAdjustInterestRate: () => ({
    mutate: mocks.mutate,
    isPending: mocks.pending,
  }),
  usePredictAdjustInterestRateUpfrontFee: () => ({
    data: mocks.fee,
    isError: mocks.feeError,
    isFetching: mocks.feeFetching,
  }),
  useRedemptionRisk: () => "medium",
  useSystemParams: () => ({
    data:
      mocks.minRate === null
        ? undefined
        : { minAnnualInterestRate: mocks.minRate },
  }),
  formatDebtAmount: (value: bigint) => `${value}:debt`,
  formatInterestRate: (value: bigint | null) =>
    value === null ? "none" : `${value}:rate`,
}));

import { RateForm } from "./rate-form";

type RateFormProps = React.ComponentProps<typeof RateForm>;
type TroveData = RateFormProps["troveData"];

const troveData = {
  annualInterestRate: 50_000_000_000_000_003n,
  debt: 100n * 10n ** 18n,
} as unknown as TroveData;
const debtToken = { symbol: "GBPm" } as RateFormProps["debtToken"];

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0x00000000000000000000000000000000000000aa",
    connected: true,
    fee: 10n,
    feeError: false,
    feeFetching: false,
    minRate: 1n * 10n ** 16n,
    pending: false,
  });
});
afterEach(cleanup);

function renderForm(data = troveData) {
  return render(
    <RateForm troveId="1" troveData={data} debtToken={debtToken} />,
  );
}

describe("RateForm", () => {
  it("requires a connected wallet and a changed rate", () => {
    mocks.connected = false;
    mocks.address = undefined;
    const { rerender } = renderForm();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy();

    mocks.connected = true;
    mocks.address = "0x00000000000000000000000000000000000000aa";
    rerender(
      <RateForm troveId="1" troveData={troveData} debtToken={debtToken} />,
    );
    expect(screen.getByRole("button", { name: "Rate unchanged" })).toBeTruthy();
  });

  it("accepts decimal input and submits with a five-percent fee buffer", () => {
    renderForm();
    fireEvent.change(
      screen.getByLabelText("New annual interest rate percent"),
      { target: { value: "6" } },
    );
    expect(screen.getByText("medium risk")).toBeTruthy();
    expect(screen.getByText("One-time Fee")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change Rate" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        newRate: 59_999_999_999_999_998n,
        maxUpfrontFee: 10n,
        successHref: "/borrow",
      }),
    );
  });

  it("rejects invalid, low, and high rates", () => {
    renderForm();
    const input = screen.getByLabelText("New annual interest rate percent");
    fireEvent.change(input, { target: { value: "abc" } });
    expect((input as HTMLInputElement).value).toBe("5.0");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Enter a rate" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "0.5" } });
    expect(
      screen.getByRole("button", { name: "Below minimum rate" }),
    ).toBeTruthy();
    expect(screen.getByText(/below the minimum/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "251" } });
    expect(screen.getByRole("button", { name: /Above max rate/ })).toBeTruthy();
    expect(screen.getByText(/above the maximum/)).toBeTruthy();
  });

  it("reports fee quote states and a pending transaction", () => {
    mocks.fee = undefined;
    mocks.feeFetching = true;
    const { rerender } = renderForm();
    fireEvent.change(
      screen.getByLabelText("New annual interest rate percent"),
      { target: { value: "6" } },
    );
    expect(
      screen.getByRole("button", { name: "Calculating upfront fee..." }),
    ).toBeTruthy();

    mocks.feeFetching = false;
    mocks.feeError = true;
    rerender(
      <RateForm troveId="1" troveData={troveData} debtToken={debtToken} />,
    );
    expect(
      screen.getByRole("button", { name: "Unable to quote upfront fee" }),
    ).toBeTruthy();

    mocks.feeError = false;
    mocks.fee = null;
    rerender(
      <RateForm troveId="1" troveData={troveData} debtToken={debtToken} />,
    );
    expect(
      screen.getByRole("button", { name: "Upfront fee unavailable" }),
    ).toBeTruthy();

    mocks.fee = 1n;
    mocks.pending = true;
    rerender(
      <RateForm troveId="1" troveData={troveData} debtToken={debtToken} />,
    );
    expect(
      screen.getByRole("button", { name: "Changing rate..." }),
    ).toBeTruthy();
  });

  it("uses slider values and handles zero debt", () => {
    renderForm({ ...troveData, debt: 0n } as TroveData);
    fireEvent.click(screen.getByRole("button", { name: "set slider" }));
    expect(
      (
        screen.getByLabelText(
          "New annual interest rate percent",
        ) as HTMLInputElement
      ).value,
    ).toBe("7.5");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "empty slider" }));
  });
});
