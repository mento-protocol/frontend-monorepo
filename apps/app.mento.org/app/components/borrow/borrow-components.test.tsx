// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loanDetails: null as null | {
    liquidationPrice: bigint;
    ltv: bigint | null;
    liquidationRisk: "low" | "medium" | "high" | null;
    maxLtv: bigint;
  },
  upfrontFee: undefined as bigint | undefined,
  switchChain: vi.fn(),
  missingTokens: new Set<string>(),
}));

vi.mock("@mento-protocol/ui", () => ({
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
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
  TokenIcon: ({ token }: { token: { symbol: string } }) => (
    <span data-testid="token-icon">{token.symbol}</span>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    children,
    value,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} data-value={value}>
      {children}
    </button>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  SelectValue: () => <span>value</span>,
}));

vi.mock("@repo/web3", () => ({
  Celo: { id: 42220, name: "Celo" },
  getDebtTokenConfig: () => ({ symbol: "GBPm", collateralSymbol: "CELO" }),
  useSwitchChainWithFeedback: () => ({ switchToChain: mocks.switchChain }),
  useExplorerUrl: () => "https://explorer.example",
  useLoanDetails: () => mocks.loanDetails,
  usePredictUpfrontFee: () => ({ data: mocks.upfrontFee }),
  formatLtv: (value: bigint) => `ltv:${value}`,
  formatPrice: (value: bigint | null) =>
    value === null ? "no price" : `price:${value}`,
  formatDebtAmount: (value: bigint) => `debt:${value}`,
  formatCollateralAmount: (value: bigint, symbol: string) =>
    `collateral:${value}:${symbol}`,
  formatInterestRate: (value: bigint) => `rate:${value}`,
}));

vi.mock("@repo/web3/wagmi", () => ({ useChainId: () => 42220 }));
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: (_chainId: number, symbol: string) => {
    if (mocks.missingTokens.has(symbol)) throw new Error("missing token");
    return `0x${symbol}`;
  },
}));

import { LoanSummary } from "./open-trove/loan-summary";
import { LTVBar } from "./open-trove/ltv-bar";
import { TokenDropdown } from "./shared/debt-token-selector";
import { FlowStep } from "./shared/flow-step";
import { RiskBadge } from "./shared/risk-badge";
import { TroveStatusBadge } from "./shared/trove-status-badge";
import { UnsupportedChainState } from "./shared/unsupported-chain-state";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.loanDetails = null;
  mocks.upfrontFee = undefined;
  mocks.missingTokens.clear();
});

const debtToken = {
  symbol: "GBPm",
  collateralSymbol: "CELO",
  collateral: "0xCELO",
  token: "0xGBPm",
} as never;

describe("borrow presentation components", () => {
  it.each([
    [0, null, "—"],
    [20, "low", "Safe"],
    [50, "medium", "Moderate"],
    [70, "high", "At Risk"],
    [95, "high", "At Risk"],
  ] as const)("renders the LTV state for %s%%", (ltv, risk, label) => {
    render(<LTVBar ltv={ltv} maxLtv={90} risk={risk} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("shows empty and complete loan summaries", () => {
    const { rerender } = render(
      <LoanSummary
        debtToken={debtToken}
        collateralSymbol="CELO"
        collAmount={0n}
        debtAmount={0n}
        interestRate={0n}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(1);

    mocks.loanDetails = {
      liquidationPrice: 2n,
      ltv: 5n,
      liquidationRisk: "low",
      maxLtv: 8n,
    };
    mocks.upfrontFee = 3n;
    rerender(
      <LoanSummary
        debtToken={debtToken}
        collateralSymbol="CELO"
        collAmount={10n}
        debtAmount={20n}
        interestRate={4n}
      />,
    );
    expect(screen.getByText("collateral:10:CELO")).toBeTruthy();
    expect(screen.getByText("debt:3")).toBeTruthy();
    expect(screen.getByText(/^ltv:/)).toBeTruthy();
  });

  it.each(["idle", "pending", "confirming", "confirmed", "error"] as const)(
    "renders a %s flow step",
    (status) => {
      render(
        <FlowStep
          isActive={status === "pending"}
          step={{
            id: status,
            label: `${status} step`,
            status,
            txHash:
              status === "confirmed" ? "0x12345678901234567890" : undefined,
            error: status === "error" ? new Error("failed") : undefined,
          }}
        />,
      );
      expect(screen.getByText(`${status} step`)).toBeTruthy();
      if (status === "confirmed") {
        expect(screen.getByRole("link").textContent).toContain("...");
      }
      if (status === "error") expect(screen.getByText("failed")).toBeTruthy();
    },
  );

  it("keeps short transaction hashes unchanged", () => {
    render(
      <FlowStep
        isActive={false}
        step={{
          id: "done",
          label: "Done",
          status: "confirmed",
          txHash: "0x123",
        }}
      />,
    );
    expect(screen.getByRole("link").textContent).toBe("0x123");
  });

  it.each([
    [null, "N/A"],
    ["low", "Low"],
    ["medium", "Med"],
    ["high", "High"],
  ] as const)("renders the %s risk badge", (risk, label) => {
    render(<RiskBadge risk={risk} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("shows details only for zombie troves", () => {
    const { rerender } = render(<TroveStatusBadge status="active" />);
    expect(screen.queryByText("Zombie")).toBeNull();
    rerender(<TroveStatusBadge status="zombie" />);
    expect(
      screen.getByRole("button", { name: "What is a zombie trove?" }),
    ).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toContain("cdp");
  });

  it.each(["borrow", "earn"] as const)(
    "switches unsupported %s users to Celo",
    async (feature) => {
      render(<UnsupportedChainState feature={feature} debtToken={debtToken} />);
      fireEvent.click(screen.getByRole("button", { name: "Switch to Celo" }));
      expect(mocks.switchChain).toHaveBeenCalledWith(42220);
    },
  );

  it("uses fallback token art when registry lookups fail", () => {
    mocks.missingTokens.add("CELO");
    mocks.missingTokens.add("GBPm");
    render(<UnsupportedChainState feature="borrow" debtToken={debtToken} />);
    expect(screen.getByText("$")).toBeTruthy();
    expect(screen.getByText("GBPm")).toBeTruthy();
  });

  it("renders token options with defaults, disabled choices, badges, and missing icons", () => {
    mocks.missingTokens.add("USDm");
    render(
      <TokenDropdown
        value="GBPm"
        onValueChange={vi.fn()}
        options={[
          { symbol: "GBPm", badge: "Recommended" },
          { symbol: "USDm", disabled: true },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "GBPm token selector" }),
    ).toBeTruthy();
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getAllByTestId("token-icon")).toHaveLength(1);
    expect(
      (screen.getByRole("button", { name: "USDm" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("accepts custom token selector presentation", () => {
    render(
      <TokenDropdown
        value="GBPm"
        onValueChange={vi.fn()}
        options={[]}
        disabled
        triggerAriaLabel="Debt token"
        triggerClassName="custom-trigger"
      />,
    );
    expect(screen.getByRole("button", { name: "Debt token" }).className).toBe(
      "custom-trigger",
    );
  });
});
