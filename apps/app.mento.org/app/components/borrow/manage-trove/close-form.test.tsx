// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  balance: 200n as bigint | undefined,
  connected: true,
  mutate: vi.fn(),
  pending: false,
}));

vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => {
    void _size;
    void _variant;
    return <button {...props}>{children}</button>;
  },
}));
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => "0xtoken",
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address, isConnected: mocks.connected }),
  useChainId: () => 42220,
  useConfig: () => ({ config: true }),
  useReadContract: () => ({ data: mocks.balance }),
}));
vi.mock("@repo/web3", () => ({
  computeBufferedDebt: (debt: bigint) => debt + 10n,
  formatCollateralAmount: (value: bigint, symbol: string) =>
    `${value} ${symbol}`,
  formatDebtTokenAmount: (value: bigint) => `${value} debt`,
  useCloseTrove: () => ({ mutate: mocks.mutate, isPending: mocks.pending }),
}));

import { CloseForm } from "./close-form";

const debtToken = { symbol: "GBPm" } as never;
const baseTrove = { collateral: 50n, debt: 100n, status: "active" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0x00000000000000000000000000000000000000aa",
    balance: 200n,
    connected: true,
    pending: false,
  });
});
afterEach(cleanup);

function renderForm(trove = baseTrove) {
  return render(
    <CloseForm
      troveId="1"
      troveData={trove}
      debtToken={debtToken}
      collateralSymbol="CELO"
    />,
  );
}

describe("CloseForm", () => {
  it("submits a funded close", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Close Trove" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        debt: 100n,
        troveId: "1",
        successHref: "/borrow",
      }),
    );
  });

  it("requires connection and sufficient balance", () => {
    mocks.connected = false;
    mocks.address = undefined;
    const { rerender } = renderForm();
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeTruthy();
    mocks.connected = true;
    mocks.address = "0x00000000000000000000000000000000000000aa";
    mocks.balance = 50n;
    rerender(
      <CloseForm
        troveId="1"
        troveData={baseTrove}
        debtToken={debtToken}
        collateralSymbol="CELO"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Insufficient balance to repay" }),
    ).toBeTruthy();
    expect(screen.getByText(/includes a small buffer/)).toBeTruthy();
  });

  it("allows a debt-free zombie and rejects another debt-free trove", () => {
    const zombie = { collateral: 50n, debt: 0n, status: "zombie" } as never;
    const { rerender } = renderForm(zombie);
    expect(screen.getByText(/no remaining GBPm debt/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Trove" }));
    expect(mocks.mutate).toHaveBeenCalled();
    rerender(
      <CloseForm
        troveId="1"
        troveData={{ collateral: 50n, debt: 0n, status: "active" } as never}
        debtToken={debtToken}
        collateralSymbol="CELO"
      />,
    );
    expect(
      screen.getByRole("button", { name: "No debt to repay" }),
    ).toBeTruthy();
  });

  it("shows the pending state", () => {
    mocks.pending = true;
    renderForm();
    expect(
      screen.getByRole("button", { name: "Closing position..." }),
    ).toBeTruthy();
  });
});
