// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ swapped: false }));
vi.mock("@mento-protocol/ui", () => ({
  TokenIcon: ({ token }: { token: { symbol: string } }) => (
    <span>icon:{token.symbol}</span>
  ),
}));
vi.mock("@repo/web3", () => ({
  getPoolDisplayOrder: () => ({ isSwapped: mocks.swapped }),
}));

import { UserPositionCard } from "./user-position-card";

const pool = {
  token0: { address: "0xa", symbol: "CELO" },
  token1: { address: "0xb", symbol: "USDm" },
} as never;

afterEach(cleanup);

describe("UserPositionCard", () => {
  it("formats a complete position", () => {
    const position = {
      totalUsdValue: 0.005,
      poolSharePercent: 1.234,
      token0: { amount: 0.5, price: 2, usdValue: 0.005 },
      token1: { amount: 150, price: 1, usdValue: 150 },
    } as never;
    render(
      <UserPositionCard
        pool={pool}
        position={position}
        lpBalance={500_000_000_000_000_000n}
      />,
    );
    expect(screen.getAllByText("<$0.01")).toHaveLength(2);
    expect(screen.getByText("0.5 LP tokens")).toBeTruthy();
    expect(screen.getByText("icon:CELO")).toBeTruthy();
  });

  it("supports swapped tokens and missing prices", () => {
    mocks.swapped = true;
    const position = {
      totalUsdValue: null,
      poolSharePercent: 0,
      token0: { amount: 50, price: null, usdValue: null },
      token1: { amount: 5, price: null, usdValue: null },
    } as never;
    render(<UserPositionCard pool={pool} position={position} lpBalance={0n} />);
    expect(screen.getByText("--")).toBeTruthy();
    expect(screen.getByText("icon:USDm")).toBeTruthy();
    expect(screen.queryByText(/LP tokens/)).toBeNull();
  });
});
