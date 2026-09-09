// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface OpportunityMock {
  apy: React.ReactNode;
  chainId: number;
  earnMechanics?: Array<{ label: string; value?: string }>;
  href: string;
  name: string;
  stats?: Array<{ label: string; value: string }>;
  type: string;
  userPosition?: { deposited: string; rewards?: string };
}

const mocks = vi.hoisted(() => ({
  connected: false,
  deployments: [] as Array<{
    chainId: number;
    token: { symbol: string; collateralSymbol: string };
  }>,
  missingToken: false,
  pools: [] as Array<Record<string, unknown>>,
  rewards: new Map<string, { apr: number }>(),
  stability: new Map<
    string,
    {
      position?: {
        deposit: bigint;
        debtTokenGain: bigint;
        collateralGain: bigint;
      } | null;
      totalDeposits?: bigint | null;
      apy?: number | null;
      avgInterestRate?: number | null;
    }
  >(),
  visiblePools: [42220] as number[],
  visibleStability: [42220] as number[],
}));

vi.mock("@/lib/stability-route", () => ({
  getStabilityRoute: (symbol: string, chainId: number) =>
    `/earn/${chainId}/${symbol}`,
  getSupportedDeployments: () => mocks.deployments,
}));
vi.mock("@/lib/opportunity-navigation", () => ({
  withOpportunitySource: (href: string, source: string) =>
    `${href}?source=${source}`,
}));
vi.mock("@mento-protocol/ui", () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <article>{children}</article>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ isConnected: mocks.connected }),
}));
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: (_chainId: number, symbol: string) => {
    if (mocks.missingToken) throw new Error("not registered");
    return `0x${symbol}`;
  },
}));
vi.mock("../pools/rewards-campaign-banner", () => ({
  RewardsCampaignBanner: () => <div>Rewards campaign</div>,
}));
vi.mock("../shared/chain-icon", () => ({
  ChainIcon: ({ chainId }: { chainId: number }) => <span>icon-{chainId}</span>,
}));
vi.mock("./opportunity-card", () => ({
  OpportunityCard: ({ opp }: { opp: OpportunityMock }) => (
    <article
      data-testid="opportunity"
      data-type={opp.type}
      data-chain={opp.chainId}
    >
      <span>{opp.name}</span>
      <span>{opp.apy}</span>
      <span>{opp.href}</span>
      {opp.stats?.map((stat: { label: string; value: string }) => (
        <span key={stat.label}>{stat.value}</span>
      ))}
      {opp.earnMechanics?.map((item: { label: string; value?: string }) => (
        <span key={item.label}>{item.value ?? item.label}</span>
      ))}
      {opp.userPosition && (
        <span>
          {opp.userPosition.deposited}:
          {opp.userPosition.rewards ?? "no rewards"}
        </span>
      )}
    </article>
  ),
}));
vi.mock("@repo/web3", () => ({
  ChainId: { Celo: 42220, Monad: 143 },
  chainIdToChain: { 42220: { name: "Celo" }, 143: { name: "Monad" } },
  chainIdToSlug: (chainId: number) => (chainId === 42220 ? "celo" : "monad"),
  getPoolDisplayOrder: (pool: { token0: unknown; token1: unknown }) => ({
    displayToken0: pool.token0,
    displayToken1: pool.token1,
  }),
  getPoolRewardKey: (chainId: number, address: string) =>
    `${chainId}:${address}`,
  useAccount: () => ({}),
  useAllPoolsList: () => ({ data: mocks.pools }),
  usePoolRewards: () => ({ rewards: mocks.rewards }),
  useVisibleChains: (feature: string) =>
    feature === "pools" ? mocks.visiblePools : mocks.visibleStability,
  useStabilityPool: (symbol: string, chainId: number) => ({
    data: mocks.stability.get(`${chainId}:${symbol}`)?.position,
  }),
  useStabilityPoolStats: (symbol: string, chainId: number) => ({
    data: mocks.stability.get(`${chainId}:${symbol}`)?.totalDeposits,
  }),
  useStabilityPoolApy: (symbol: string, chainId: number) => ({
    data: mocks.stability.get(`${chainId}:${symbol}`)?.apy,
    avgInterestRate: mocks.stability.get(`${chainId}:${symbol}`)
      ?.avgInterestRate,
  }),
}));

import { EarnHub } from "./earn-hub";

afterEach(cleanup);
beforeEach(() => {
  mocks.connected = false;
  mocks.deployments = [];
  mocks.missingToken = false;
  mocks.pools = [];
  mocks.rewards = new Map();
  mocks.stability = new Map();
  mocks.visiblePools = [42220];
  mocks.visibleStability = [42220];
});

const fpmmPool = (overrides: Record<string, unknown> = {}) => ({
  poolAddr: "0xpool",
  chainId: 42220,
  poolType: "FPMM",
  token0: { symbol: "CELO", address: "0xcelo" },
  token1: { symbol: "USDm", address: "0xusd" },
  fees: { lp: 0.2 },
  tvl: 2_500_000,
  ...overrides,
});

describe("EarnHub", () => {
  it("shows an empty result and fallback chain label", () => {
    mocks.visiblePools = [999];
    mocks.visibleStability = [];
    render(<EarnHub />);
    expect(
      screen.getByText("No opportunities match the current filter."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Chain 999/ })).toBeTruthy();
  });

  it("builds and sorts connected stability and LP opportunities", async () => {
    mocks.connected = true;
    mocks.deployments = [
      { chainId: 42220, token: { symbol: "GBPm", collateralSymbol: "CELO" } },
      { chainId: 143, token: { symbol: "USDm", collateralSymbol: "MON" } },
    ];
    mocks.visibleStability = [42220, 143];
    mocks.visiblePools = [42220, 143];
    mocks.stability.set("42220:GBPm", {
      position: {
        deposit: 2_000n * 10n ** 18n,
        debtTokenGain: 3n * 10n ** 18n,
        collateralGain: 4n * 10n ** 18n,
      },
      totalDeposits: 2_000_000n * 10n ** 18n,
      apy: 0.15,
      avgInterestRate: 0.07,
    });
    mocks.stability.set("143:USDm", {
      position: { deposit: 0n, debtTokenGain: 0n, collateralGain: 0n },
      totalDeposits: 0n,
      apy: null,
      avgInterestRate: null,
    });
    mocks.pools = [
      fpmmPool(),
      fpmmPool({
        poolAddr: "0xsmall",
        chainId: 143,
        tvl: 2_500,
        fees: { lp: 0.1 },
      }),
      fpmmPool({ poolAddr: "0xunknown", tvl: null, fees: { lp: 0 } }),
      fpmmPool({ poolAddr: "0xlegacy", poolType: "Legacy" }),
    ];
    mocks.rewards.set("42220:0xpool", { apr: 2.5 });

    render(<EarnHub />);
    await waitFor(() =>
      expect(screen.getAllByTestId("opportunity")).toHaveLength(5),
    );
    expect(screen.getByText("Rewards campaign")).toBeTruthy();
    expect(screen.getByText("2.0M GBPm")).toBeTruthy();
    const opportunityText = screen
      .getAllByTestId("opportunity")
      .map((element) => element.textContent)
      .join(" ");
    expect(opportunityText).toContain("2.0K GBPm:3.00 GBPm + 4.00 CELO");
    expect(screen.getByText("$2.50M")).toBeTruthy();
    expect(screen.getByText("$2.5K")).toBeTruthy();
    expect(screen.getByText("+2.5%")).toBeTruthy();
  });

  it("filters by opportunity type and chain", async () => {
    mocks.deployments = [
      { chainId: 42220, token: { symbol: "GBPm", collateralSymbol: "CELO" } },
    ];
    mocks.pools = [fpmmPool(), fpmmPool({ chainId: 143, poolAddr: "0xmonad" })];
    mocks.visiblePools = [42220, 143];
    render(<EarnHub />);
    await waitFor(() =>
      expect(screen.getAllByTestId("opportunity")).toHaveLength(3),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stability Pool" }));
    expect(screen.getAllByTestId("opportunity")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Liquidity Pools" }));
    expect(screen.getAllByTestId("opportunity")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Monad/ }));
    expect(screen.getAllByTestId("opportunity")).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "All" })[1]!);
    expect(screen.getAllByTestId("opportunity")).toHaveLength(2);
  });

  it("handles missing token addresses and stability rewards without a deposit", async () => {
    mocks.connected = true;
    mocks.missingToken = true;
    mocks.deployments = [
      { chainId: 42220, token: { symbol: "GBPm", collateralSymbol: "CELO" } },
    ];
    mocks.stability.set("42220:GBPm", {
      position: {
        deposit: 0n,
        debtTokenGain: 2n * 10n ** 18n,
        collateralGain: 0n,
      },
      totalDeposits: 500n * 10n ** 18n,
      apy: 0,
      avgInterestRate: 0,
    });
    render(<EarnHub />);
    await waitFor(() => expect(screen.getByTestId("opportunity")).toBeTruthy());
    expect(screen.getByText("500.00 GBPm")).toBeTruthy();
    expect(screen.getByText("0 GBPm:2.00 GBPm")).toBeTruthy();
  });
});
