import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

const mockToken = {
  symbol: "GBPm",
  collateralSymbol: "CELO",
};

let mockSupportedDebtTokens = [mockToken];
let mockCollateralPrices: Record<string, bigint | null> = {
  GBPm: 10n ** 18n,
};
let mockCollateralPriceErrors: Record<string, Error | null> = {
  GBPm: null,
};

let mockTroves: Array<{
  troveId: string;
  collateral: bigint;
  debt: bigint;
  ltv: number;
}> = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/stability-route", () => ({
  getSupportedDebtTokens: () => mockSupportedDebtTokens,
}));

vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => "0x0000000000000000000000000000000000000001",
}));

vi.mock("@repo/ui", () => ({
  Button: ({
    children,
    onClick,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  Card: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  ),
  CardContent: ({
    children,
    ...rest
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
  TokenIcon: () => <div data-testid="token-icon" />,
}));

vi.mock("@repo/web3", () => ({
  ConnectButton: () => <button>Connect</button>,
  formatCollateralAmount: (amount: bigint, symbol: string) =>
    `${amount.toString()} ${symbol}`,
  getDebtTokenConfig: () => mockToken,
  useClaimCollateral: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCollateralPrice: (symbol: string) => ({
    data: mockCollateralPrices[symbol] ?? 10n ** 18n,
    isLoading: false,
    error: mockCollateralPriceErrors[symbol] ?? null,
  }),
  useSurplusCollateral: () => ({
    data: 0n,
    isLoading: false,
  }),
  useUserTroves: () => ({
    data: mockTroves,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({
    address: "0x0000000000000000000000000000000000000001",
    isConnected: true,
  }),
  useChainId: () => 42220,
  useConfig: () => ({}),
}));

vi.mock("./trove-list", () => ({
  TroveList: ({
    troves,
  }: {
    troves: Array<{
      position: { troveId: string };
      debtToken: { symbol: string };
    }>;
    isLoading: boolean;
  }) => (
    <div data-testid="trove-list">
      {troves.map(({ position, debtToken }) => (
        <div key={`${debtToken.symbol}:${position.troveId}`}>
          {debtToken.symbol}:{position.troveId}
        </div>
      ))}
    </div>
  ),
}));

import { BorrowDashboard } from "./borrow-dashboard";

describe("BorrowDashboard", () => {
  beforeEach(() => {
    mockTroves = [];
    mockSupportedDebtTokens = [mockToken];
    mockCollateralPrices = { GBPm: 10n ** 18n };
    mockCollateralPriceErrors = { GBPm: null };
    pushMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps observers active in the empty state so new positions appear without leaving the page", async () => {
    const { rerender } = render(<BorrowDashboard />);

    await waitFor(() => {
      expect(screen.getByText("How borrowing works")).toBeTruthy();
    });

    mockTroves = [
      {
        troveId: "1",
        collateral: 10n ** 18n,
        debt: 5n * 10n ** 17n,
        ltv: 50,
      },
    ];

    rerender(<BorrowDashboard />);

    await waitFor(() => {
      expect(screen.queryByText("How borrowing works")).toBeNull();
      expect(screen.getByTestId("trove-list").textContent).toContain("GBPm:1");
    });
  });

  it("fails closed for aggregate debt and ltv when a market price is invalid", async () => {
    mockTroves = [
      {
        troveId: "1",
        collateral: 10n ** 18n,
        debt: 5n * 10n ** 17n,
        ltv: 50,
      },
    ];
    mockCollateralPrices = { GBPm: 0n };

    render(<BorrowDashboard />);

    await waitFor(() => {
      expect(
        screen.getByText(/market prices failed to load or returned invalid/i),
      ).toBeTruthy();
      expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    });
  });

  it("uses a responsive summary grid instead of a fixed four-column inline layout", async () => {
    mockTroves = [
      {
        troveId: "1",
        collateral: 10n ** 18n,
        debt: 5n * 10n ** 17n,
        ltv: 50,
      },
    ];

    render(<BorrowDashboard />);

    await waitFor(() => {
      const grid = screen.getByTestId("portfolio-summary-grid");
      expect(grid.className).toContain("grid-cols-1");
      expect(grid.className).toContain("sm:grid-cols-2");
      expect(grid.className).toContain("xl:grid-cols-4");
      expect(grid.getAttribute("style")).toBeNull();
    });
  });
});
