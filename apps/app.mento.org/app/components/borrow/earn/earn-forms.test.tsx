// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0xabc" as string | undefined,
  balance: (100n * 10n ** 18n) as bigint | undefined,
  connected: true,
  depositMutate: vi.fn(),
  depositPending: false,
  withdrawMutate: vi.fn(),
  withdrawPending: false,
  claimMutate: vi.fn(),
  claimPending: false,
}));

vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    asChild,
    size: _size,
    variant: _variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    size?: string;
    variant?: string;
  }) => {
    void _size;
    void _variant;
    return asChild ? <>{children}</> : <button {...props}>{children}</button>;
  },
  CoinInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  TokenIcon: () => <span>icon</span>,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/stability-route", () => ({
  getStabilitySwapRoute: (symbol: string) => `/swap/${symbol}`,
}));
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => "0xtoken",
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address, isConnected: mocks.connected }),
  useConfig: () => ({ config: true }),
  useReadContract: () => ({ data: mocks.balance }),
}));
vi.mock("@repo/web3", () => ({
  useSpDeposit: () => ({
    mutate: mocks.depositMutate,
    isPending: mocks.depositPending,
  }),
  useSpWithdraw: () => ({
    mutate: mocks.withdrawMutate,
    isPending: mocks.withdrawPending,
  }),
  useSpClaimRewards: () => ({
    mutate: mocks.claimMutate,
    isPending: mocks.claimPending,
  }),
  formatCompactBalance: (value: string) => value,
  tryParseUnits: (value: string) => {
    if (!value || value === "bad") return null;
    return BigInt(value) * 10n ** 18n;
  },
}));

import { ClaimRewards } from "./claim-rewards";
import { DepositForm } from "./deposit-form";
import { WithdrawForm } from "./withdraw-form";

const debtToken = { symbol: "GBPm", collateralSymbol: "CELO" } as never;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0xabc",
    balance: 100n * 10n ** 18n,
    connected: true,
    depositPending: false,
    withdrawPending: false,
    claimPending: false,
  });
});
afterEach(cleanup);

function deposit(overrides: Record<string, unknown> = {}) {
  return (
    <DepositForm
      deposit={0n}
      collateralGain={0n}
      debtTokenGain={0n}
      debtToken={debtToken}
      targetChainId={42220 as never}
      {...overrides}
    />
  );
}
function withdraw(overrides: Record<string, unknown> = {}) {
  return (
    <WithdrawForm
      deposit={100n * 10n ** 18n}
      collateralGain={0n}
      debtTokenGain={0n}
      debtToken={debtToken}
      targetChainId={42220 as never}
      {...overrides}
    />
  );
}

describe("DepositForm", () => {
  it("uses percentage and maximum wallet balance presets", () => {
    render(deposit());
    fireEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(
      (screen.getByLabelText("Deposit amount in GBPm") as HTMLInputElement)
        .value,
    ).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: "MAX deposit GBPm" }));
    expect(
      (screen.getByLabelText("Deposit amount in GBPm") as HTMLInputElement)
        .value,
    ).toBe("100");
  });

  it("submits a valid deposit and preserves a custom claim preference", () => {
    render(deposit({ collateralGain: 1n }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Deposit amount in GBPm"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(mocks.depositMutate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5n * 10n ** 18n, doClaim: false }),
    );
  });

  it("shows disabled, pending, invalid, and insufficient states", () => {
    const { rerender } = render(deposit({ disabled: true }));
    expect(
      screen.getByRole("button", { name: "Switch network to deposit" }),
    ).toBeTruthy();
    rerender(deposit());
    fireEvent.change(screen.getByLabelText("Deposit amount in GBPm"), {
      target: { value: "bad" },
    });
    expect(
      screen.getByRole("button", { name: "Enter amount to deposit" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Deposit amount in GBPm"), {
      target: { value: "101" },
    });
    expect(screen.getAllByText("Insufficient GBPm balance")).toHaveLength(2);
    mocks.depositPending = true;
    rerender(deposit());
    expect(screen.getByRole("button", { name: "Depositing..." })).toBeTruthy();
  });

  it("offers a swap to connected users with zero balance and no position", () => {
    mocks.balance = 0n;
    render(deposit());
    expect(
      screen
        .getByRole("link", { name: /Swap USDm for GBPm/ })
        .getAttribute("href"),
    ).toBe("/swap/GBPm");
  });

  it("ignores presets without a balance", () => {
    mocks.balance = undefined;
    render(deposit());
    fireEvent.click(screen.getByRole("button", { name: "50%" }));
    expect(
      (screen.getByLabelText("Deposit amount in GBPm") as HTMLInputElement)
        .value,
    ).toBe("");
  });
});

describe("WithdrawForm", () => {
  it("uses percentage and maximum deposit presets", () => {
    render(withdraw());
    fireEvent.click(screen.getByRole("button", { name: "75%" }));
    expect(
      (screen.getByLabelText("Withdraw amount in GBPm") as HTMLInputElement)
        .value,
    ).toBe("75");
    fireEvent.click(screen.getByRole("button", { name: "MAX withdraw GBPm" }));
    expect(
      (screen.getByLabelText("Withdraw amount in GBPm") as HTMLInputElement)
        .value,
    ).toBe("100");
  });

  it("submits a valid withdrawal with rewards", () => {
    render(withdraw({ debtTokenGain: 1n }));
    fireEvent.change(screen.getByLabelText("Withdraw amount in GBPm"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(mocks.withdrawMutate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5n * 10n ** 18n, doClaim: true }),
    );
  });

  it("shows disabled, pending, invalid, and excess states", () => {
    const { rerender } = render(withdraw({ disabled: true }));
    expect(
      screen.getByRole("button", { name: "Switch network to withdraw" }),
    ).toBeTruthy();
    rerender(withdraw());
    fireEvent.change(screen.getByLabelText("Withdraw amount in GBPm"), {
      target: { value: "bad" },
    });
    expect(
      screen.getByRole("button", { name: "Enter amount to withdraw" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Withdraw amount in GBPm"), {
      target: { value: "101" },
    });
    expect(screen.getAllByText("Amount exceeds your deposit")).toHaveLength(2);
    mocks.withdrawPending = true;
    rerender(withdraw());
    expect(screen.getByRole("button", { name: "Withdrawing..." })).toBeTruthy();
  });

  it("ignores percentage presets for an empty deposit", () => {
    render(withdraw({ deposit: null }));
    fireEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(
      (screen.getByLabelText("Withdraw amount in GBPm") as HTMLInputElement)
        .value,
    ).toBe("");
  });
});

describe("ClaimRewards", () => {
  it("omits the action without rewards", () => {
    const { container } = render(
      <ClaimRewards
        debtToken={debtToken}
        hasActiveDeposit={false}
        collateralGain={0n}
        debtTokenGain={null}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("submits, disables, and reports pending reward claims", () => {
    const { rerender } = render(
      <ClaimRewards
        debtToken={debtToken}
        hasActiveDeposit
        collateralGain={1n}
        debtTokenGain={0n}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Claim rewards" }));
    expect(mocks.claimMutate).toHaveBeenCalledWith(
      expect.objectContaining({ hasDeposit: true }),
    );
    rerender(
      <ClaimRewards
        debtToken={debtToken}
        hasActiveDeposit
        collateralGain={1n}
        debtTokenGain={0n}
        disabled
      />,
    );
    expect(
      screen.getByRole("button", { name: "Switch network to claim rewards" }),
    ).toBeTruthy();
    mocks.claimPending = true;
    rerender(
      <ClaimRewards
        debtToken={debtToken}
        hasActiveDeposit
        collateralGain={1n}
        debtTokenGain={0n}
      />,
    );
    expect(screen.getByRole("button", { name: "Claiming..." })).toBeTruthy();
  });
});
