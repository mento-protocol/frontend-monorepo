import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();

const mockToken = {
  symbol: "GBPm",
  collateralSymbol: "CELO",
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
  getSupportedDebtTokens: () => [mockToken],
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
  useCollateralPrice: () => ({
    data: 10n ** 18n,
    isLoading: false,
    error: null,
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
    pushMock.mockReset();
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
});
