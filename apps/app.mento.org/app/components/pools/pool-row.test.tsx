// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    asChild,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
    size?: string;
  }) => {
    void _size;
    return asChild ? <>{children}</> : <button {...props}>{children}</button>;
  },
  Collapsible: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleContent: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  TokenIcon: ({ token }: { token: { symbol: string } }) => (
    <span>{token.symbol}</span>
  ),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
  Skeleton: () => <span data-testid="skeleton" />,
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
vi.mock("./pool-address-popover", () => ({
  PoolAddressPopover: () => <span>address</span>,
}));
vi.mock("./pool-fee-popover", () => ({
  PoolFeePopover: () => <span>fee details</span>,
}));
vi.mock("./rebalance-panel", () => ({
  RebalancePanel: ({
    onRebalanceComplete,
  }: {
    onRebalanceComplete: () => void;
  }) => <button onClick={onRebalanceComplete}>Complete rebalance</button>,
}));
vi.mock("../shared/chain-icon", () => ({
  ChainIcon: () => <span>chain</span>,
}));
vi.mock("@repo/web3", () => ({
  getPoolDisplayOrder: (pool: {
    reserves: { token0: unknown; token0Ratio: number; token1: unknown };
    token0: unknown;
    token1: unknown;
  }) => ({
    displayToken0: pool.token0,
    displayToken1: pool.token1,
    displayReserve0: pool.reserves.token0,
    displayReserve1: pool.reserves.token1,
    displayRatio0: pool.reserves.token0Ratio,
  }),
  getPoolRewardKey: (chainId: number, address: string) =>
    `${chainId}:${address}`,
}));

import { PoolRow } from "./pool-row";
import { PoolsTable } from "./pools-table";

afterEach(cleanup);

const makePool = (overrides: Record<string, unknown> = {}) =>
  ({
    poolAddr: "0xpool",
    chainId: 42220,
    poolType: "FPMM",
    token0: { address: "0xaaa", symbol: "CELO" },
    token1: { address: "0xbbb", symbol: "USDm" },
    reserves: {
      token0: "10",
      token1: "20",
      token0Ratio: 0.7,
      hasLiquidity: true,
    },
    fees: { total: 0.3 },
    tvl: 2_500_000,
    ...overrides,
  }) as never;

describe("PoolRow", () => {
  it("shows loading actions while an FPMM balance loads", () => {
    render(
      <PoolRow
        pool={makePool()}
        hasLPTokens={false}
        isLpBalanceLoading
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Loading..." })).toHaveLength(
      2,
    );
    expect(screen.getByText("$2.5M")).toBeTruthy();
    expect(screen.getByText("70%")).toBeTruthy();
  });

  it.each([
    [false, "/pools/celo/0xpool"],
    [true, "/pools/celo/0xpool?mode=manage"],
  ])("links position=%s to %s", (hasLPTokens, href) => {
    render(
      <PoolRow
        pool={makePool({ tvl: 2_500 })}
        hasLPTokens={hasLPTokens}
        isLpBalanceLoading={false}
        onSelect={vi.fn()}
        poolHref="/pools/celo/0xpool"
      />,
    );
    expect(screen.getAllByRole("link")[0]?.getAttribute("href")).toBe(href);
    expect(screen.getByText("$2.5K")).toBeTruthy();
  });

  it("selects deposit and manage actions without a link", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <PoolRow
        pool={makePool({ tvl: 12 })}
        hasLPTokens={false}
        isLpBalanceLoading={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Deposit" })[0]!);
    expect(onSelect).toHaveBeenCalledWith(expect.anything(), "deposit");
    expect(screen.getByText("$12.0")).toBeTruthy();
    rerender(
      <PoolRow
        pool={makePool()}
        hasLPTokens
        isLpBalanceLoading={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]!);
    expect(onSelect).toHaveBeenLastCalledWith(expect.anything(), "manage");
  });

  it("shows legacy, empty-liquidity, and missing-TVL states without actions", () => {
    render(
      <PoolRow
        pool={makePool({
          poolType: "Legacy",
          tvl: null,
          reserves: {
            token0: "0",
            token1: "0",
            token0Ratio: 2,
            hasLiquidity: false,
          },
        })}
        hasLPTokens={false}
        isLpBalanceLoading={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("LEGACY")).toBeTruthy();
    expect(screen.getByText("No liquidity yet")).toBeTruthy();
    expect(screen.getByText("--")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Deposit" })).toBeNull();
  });

  it("shows rewards and toggles rebalance details", () => {
    render(
      <PoolRow
        pool={makePool({
          rebalancing: { canRebalance: true },
          reserves: {
            token0: "10",
            token1: "20",
            token0Ratio: -1,
            hasLiquidity: true,
          },
        })}
        hasLPTokens={false}
        isLpBalanceLoading={false}
        onSelect={vi.fn()}
        rewards={{ apr: 3.25 } as never}
      />,
    );
    expect(screen.getByText("+3.3%")).toBeTruthy();
    const toggle = screen.getByRole("button", {
      name: "Show rebalance details",
    });
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: "Hide rebalance details" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Complete rebalance" }));
    expect(
      screen.getByRole("button", { name: "Show rebalance details" }),
    ).toBeTruthy();
  });
});

describe("PoolsTable", () => {
  it("shows loading, empty, and incremental loading states", () => {
    const props = { pools: [], onSelectPool: vi.fn(), isLoading: true };
    const { rerender } = render(<PoolsTable {...props} />);
    expect(screen.getAllByTestId("skeleton")).toHaveLength(24);
    rerender(<PoolsTable {...props} isLoading={false} />);
    expect(screen.getByText("No pools found")).toBeTruthy();
    rerender(<PoolsTable {...props} isLoading={false} isFetchingMore />);
    expect(screen.getAllByTestId("skeleton")).toHaveLength(8);
  });

  it("passes position, reward, and link data into pool rows", () => {
    const pool = makePool();
    render(
      <PoolsTable
        pools={[pool]}
        isLoading={false}
        isPositionsLoading
        onSelectPool={vi.fn()}
        getPoolHref={() => "/pool"}
        positionBalancesByPool={new Map([["42220:0xpool", 1n]])}
        rewards={new Map([["42220:0xpool", { apr: 1 } as never]])}
      />,
    );
    expect(screen.getByText("+1.0%")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Loading..." })).toHaveLength(
      2,
    );
  });
});
