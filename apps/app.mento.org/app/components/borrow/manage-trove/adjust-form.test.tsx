// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  balance: 5n * 10n ** 18n,
  connected: true,
  loanDetails: {
    ltv: 2n,
    liquidationPrice: 3n,
    liquidationRisk: "low",
    status: "active",
    maxLtv: 4n,
  } as {
    liquidationPrice: bigint;
    liquidationRisk: string;
    ltv: bigint;
    maxLtv: bigint;
    status: string;
  } | null,
  minDebt: (2n * 10n ** 18n) as bigint | null,
  mutate: vi.fn(),
  pending: false,
  upfrontFee: (1n * 10n ** 18n) as bigint | null | undefined,
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
  CoinInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));
vi.mock("../shared/risk-badge", () => ({
  RiskBadge: ({ risk }: { risk: string }) => <span>{risk} risk</span>,
}));
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => "0xcelo",
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address, isConnected: mocks.connected }),
  useChainId: () => 42220,
  useConfig: () => ({ config: true }),
  useReadContract: () => ({ data: mocks.balance }),
}));
vi.mock("@repo/web3", () => ({
  useAdjustTrove: () => ({ mutate: mocks.mutate, isPending: mocks.pending }),
  useLoanDetails: () => mocks.loanDetails,
  usePredictUpfrontFee: () => ({ data: mocks.upfrontFee }),
  useSystemParams: () => ({
    data: mocks.minDebt === null ? undefined : { minDebt: mocks.minDebt },
  }),
  formatCollateralAmount: (value: bigint, symbol: string) =>
    `${value}:${symbol}`,
  formatDebtAmount: (value: bigint) => `${value}:debt`,
  formatLtv: (value: bigint) => `${value}:ltv`,
  formatPrice: (value: bigint) => `${value}:price`,
  formatCompactBalance: (value: string) => value,
  tryParseUnits: (value: string) => (value ? BigInt(value) * 10n ** 18n : null),
}));

import { AdjustForm } from "./adjust-form";

const troveData = {
  troveId: "1",
  collateral: 10n * 10n ** 18n,
  debt: 10n * 10n ** 18n,
  annualInterestRate: 5n,
  status: "active",
} as never;
const debtToken = { symbol: "GBPm", collateralSymbol: "CELO" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0x00000000000000000000000000000000000000aa",
    balance: 5n * 10n ** 18n,
    connected: true,
    loanDetails: {
      ltv: 2n,
      liquidationPrice: 3n,
      liquidationRisk: "low",
      status: "active",
      maxLtv: 4n,
    },
    minDebt: 2n * 10n ** 18n,
    pending: false,
    upfrontFee: 1n * 10n ** 18n,
  });
});
afterEach(cleanup);

function renderForm() {
  return render(
    <AdjustForm
      troveId="1"
      troveData={troveData}
      debtToken={debtToken}
      collateralSymbol="CELO"
    />,
  );
}

describe("AdjustForm", () => {
  it("requires connection and a change", () => {
    mocks.connected = false;
    mocks.address = undefined;
    const { rerender } = renderForm();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy();
    mocks.connected = true;
    mocks.address = "0x00000000000000000000000000000000000000aa";
    rerender(
      <AdjustForm
        troveId="1"
        troveData={troveData}
        debtToken={debtToken}
        collateralSymbol="CELO"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Enter an amount" }),
    ).toBeTruthy();
  });

  it("uses wallet and deposited collateral maximums", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "MAX CELO" }));
    expect(
      (
        screen.getByLabelText(
          "Add collateral amount in CELO",
        ) as HTMLInputElement
      ).value,
    ).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "MAX CELO" }));
    expect(
      (
        screen.getByLabelText(
          "Remove collateral amount in CELO",
        ) as HTMLInputElement
      ).value,
    ).toBe("10");
    expect(screen.getByText(/Deposited:/)).toBeTruthy();
  });

  it("reports insufficient wallet collateral", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Add collateral amount in CELO"), {
      target: { value: "6" },
    });
    expect(screen.getAllByText("Insufficient CELO balance")).toHaveLength(2);
  });

  it("reports collateral removal above the position", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.change(
      screen.getByLabelText("Remove collateral amount in CELO"),
      { target: { value: "11" } },
    );
    expect(screen.getAllByText("Exceeds current collateral")).toHaveLength(2);
  });

  it("fills maximum repayment and rejects excess debt", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Repay" }));
    fireEvent.click(screen.getByRole("button", { name: "MAX GBPm" }));
    expect(
      (screen.getByLabelText("Repay amount in GBPm") as HTMLInputElement).value,
    ).toBe("10");
    fireEvent.change(screen.getByLabelText("Repay amount in GBPm"), {
      target: { value: "11" },
    });
    expect(screen.getAllByText("Exceeds current debt")).toHaveLength(2);
  });

  it("rejects debt below the system minimum", () => {
    mocks.minDebt = 9n * 10n ** 18n;
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Repay" }));
    fireEvent.change(screen.getByLabelText("Repay amount in GBPm"), {
      target: { value: "2" },
    });
    expect(
      screen.getByRole("button", { name: "Below minimum debt" }),
    ).toBeTruthy();
    expect(screen.getByText("New debt would be below minimum")).toBeTruthy();
  });

  it("rejects a liquidatable adjustment", () => {
    mocks.loanDetails = {
      ltv: 9n,
      liquidationPrice: 3n,
      liquidationRisk: "high",
      status: "liquidatable",
      maxLtv: 4n,
    };
    renderForm();
    fireEvent.change(screen.getByLabelText("Borrow more amount in GBPm"), {
      target: { value: "1" },
    });
    expect(
      screen.getByRole("button", { name: "Position would be liquidatable" }),
    ).toBeTruthy();
    expect(screen.getByText(/would make the trove liquidatable/)).toBeTruthy();
  });

  it("shows the pending transaction state", () => {
    mocks.pending = true;
    renderForm();
    fireEvent.change(screen.getByLabelText("Add collateral amount in CELO"), {
      target: { value: "1" },
    });
    expect(
      screen.getByRole("button", { name: "Adjusting position..." }),
    ).toBeTruthy();
  });

  it("submits collateral and debt increases with an upfront-fee buffer", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Add collateral amount in CELO"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Borrow more amount in GBPm"), {
      target: { value: "2" },
    });
    expect(screen.getByText("1000000000000000000:debt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Adjustment" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          isCollIncrease: true,
          isDebtIncrease: true,
          maxUpfrontFee: 1_050_000_000_000_000_000n,
        }),
      }),
    );
  });

  it("uses a fallback fee and submits collateral removal with debt repayment", () => {
    mocks.upfrontFee = undefined;
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.change(
      screen.getByLabelText("Remove collateral amount in CELO"),
      { target: { value: "1" } },
    );
    fireEvent.change(screen.getByLabelText("Borrow more amount in GBPm"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Adjustment" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          isCollIncrease: false,
          maxUpfrontFee: 20_000_000_000_000_000n,
        }),
      }),
    );
  });
});
