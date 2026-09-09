// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apy: undefined as number | null | undefined,
  apyLoading: false,
  avgRate: undefined as number | null | undefined,
  connected: false,
  missingTokens: false,
  position: undefined as
    | {
        collateralGain: bigint | null;
        debtTokenGain: bigint | null;
        deposit: bigint;
        hasActiveDeposit?: boolean;
      }
    | null
    | undefined,
  positionLoading: false,
  source: null as string | null,
  statsLoading: false,
  totalDeposits: undefined as bigint | null | undefined,
  walletChain: 42220,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => mocks.source }),
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
vi.mock("@mento-protocol/ui", () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
  TabsContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TokenIcon: ({ token }: { token: { symbol: string } }) => (
    <span data-testid="token">{token.symbol}</span>
  ),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ isConnected: mocks.connected }),
  useChainId: () => mocks.walletChain,
}));
vi.mock("@repo/web3", () => ({
  useStabilityPool: () => ({
    data: mocks.position,
    isLoading: mocks.positionLoading,
  }),
  useStabilityPoolStats: () => ({
    data: mocks.totalDeposits,
    isLoading: mocks.statsLoading,
  }),
  useStabilityPoolApy: () => ({
    data: mocks.apy,
    avgInterestRate: mocks.avgRate,
    isLoading: mocks.apyLoading,
  }),
}));
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => {
    if (mocks.missingTokens) throw new Error("missing");
    return "0xtoken";
  },
}));
vi.mock("../shared/flow-dialog", () => ({
  FlowDialog: () => <div>flow dialog</div>,
}));
vi.mock("@/components/shared/chain-mismatch-banner", () => ({
  ChainMismatchBanner: () => <div>chain banner</div>,
}));
vi.mock("@/lib/opportunity-navigation", () => ({
  getOpportunityBackLink: (source: string | null) =>
    source === "earn"
      ? { href: "/earn", label: "Back to Earn" }
      : { href: "/borrow", label: "Back to Borrow" },
}));
vi.mock("./deposit-form", () => ({
  DepositForm: ({ disabled }: { disabled: boolean }) => (
    <div>deposit form {String(disabled)}</div>
  ),
}));
vi.mock("./withdraw-form", () => ({
  WithdrawForm: ({ disabled }: { disabled: boolean }) => (
    <div>withdraw form {String(disabled)}</div>
  ),
}));
vi.mock("./claim-rewards", () => ({
  ClaimRewards: ({ disabled }: { disabled: boolean }) => (
    <div>claim rewards {String(disabled)}</div>
  ),
}));

import { EarnView } from "./earn-view";

const debtToken = { symbol: "GBPm", collateralSymbol: "CELO" } as never;
beforeEach(() => {
  Object.assign(mocks, {
    apy: undefined,
    apyLoading: false,
    avgRate: undefined,
    connected: false,
    missingTokens: false,
    position: undefined,
    positionLoading: false,
    source: null,
    statsLoading: false,
    totalDeposits: undefined,
    walletChain: 42220,
  });
});
afterEach(cleanup);

describe("EarnView", () => {
  it("shows disconnected and unavailable pool data", () => {
    render(<EarnView chainId={42220 as never} debtToken={debtToken} />);
    expect(
      screen.getByText("Connect your wallet to view your position."),
    ).toBeTruthy();
    expect(
      screen.getByText("Connect your wallet to deposit or withdraw."),
    ).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "Back to Borrow" }).getAttribute("href"),
    ).toBe("/borrow");
  });

  it("renders loading skeletons for stats, APY, and position", () => {
    mocks.connected = true;
    mocks.positionLoading = true;
    mocks.apyLoading = true;
    render(<EarnView chainId={42220 as never} debtToken={debtToken} />);
    expect(
      document.querySelectorAll(".animate-pulse").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("shows an empty connected position with fallback token art", () => {
    mocks.connected = true;
    mocks.missingTokens = true;
    mocks.position = { deposit: 0n, debtTokenGain: 0n, collateralGain: 0n };
    mocks.totalDeposits = 500n * 10n ** 18n;
    mocks.apy = 0;
    mocks.avgRate = null;
    mocks.source = "earn";
    render(<EarnView chainId={42220 as never} debtToken={debtToken} />);
    expect(
      screen.getByText("No deposit yet — deposit to start earning."),
    ).toBeTruthy();
    expect(screen.getByText("500.00 GBPm")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Earn" })).toBeTruthy();
  });

  it("shows deposits, both rewards, pool share, and wrong-chain form state", () => {
    mocks.connected = true;
    mocks.walletChain = 143;
    mocks.position = {
      deposit: 2_000n * 10n ** 18n,
      debtTokenGain: 2_000_000n * 10n ** 18n,
      collateralGain: 5n * 10n ** 18n,
      hasActiveDeposit: true,
    };
    mocks.totalDeposits = 10_000n * 10n ** 18n;
    mocks.apy = 0.12;
    mocks.avgRate = 0.07;
    render(<EarnView chainId={42220 as never} debtToken={debtToken} />);
    expect(screen.getByText("2.0K GBPm")).toBeTruthy();
    expect(screen.getByText("2.0M GBPm")).toBeTruthy();
    expect(screen.getByText("5.00 USDm")).toBeTruthy();
    expect(screen.getByText("20.00% POOL SHARE")).toBeTruthy();
    expect(screen.getByText("claim rewards true")).toBeTruthy();
    expect(screen.getByText("deposit form true")).toBeTruthy();
  });

  it("shows a deposit without rewards or pool share when totals are zero", () => {
    mocks.connected = true;
    mocks.position = { deposit: 1n, debtTokenGain: null, collateralGain: null };
    mocks.totalDeposits = 0n;
    render(<EarnView chainId={42220 as never} debtToken={debtToken} />);
    expect(screen.getByText("No claimable rewards yet.")).toBeTruthy();
    expect(screen.queryByText(/POOL SHARE/)).toBeNull();
  });
});
