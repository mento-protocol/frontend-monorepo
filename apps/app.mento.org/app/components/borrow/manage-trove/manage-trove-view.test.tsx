import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const pushMock = vi.fn();

const GBPm = {
  symbol: "GBPm",
  currencySymbol: "£",
  currencyCode: "GBP",
  locale: "en-GB",
  collateralSymbol: "USDm",
};

let mockSupportedDebtTokens = [GBPm];
let mockTroveData: object | null = null;
let mockIsLoading = false;
let mockIsError = false;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/stability-route", () => ({
  getSupportedDebtTokens: () => mockSupportedDebtTokens,
}));

vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => undefined,
}));

vi.mock("@repo/ui", () => ({
  Card: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  ),
  CardContent: ({
    children,
    ...rest
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <div data-tab={value}>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <button data-tab-trigger={value}>{children}</button>,
  Skeleton: () => <div data-testid="skeleton" />,
  TokenIcon: () => <div data-testid="token-icon" />,
}));

vi.mock("@repo/web3", () => ({
  formatCollateralAmount: (amount: bigint, symbol: string) =>
    `${amount} ${symbol}`,
  formatDebtAmount: (amount: bigint) => amount.toString(),
  formatInterestRate: (rate: bigint) => `${rate}%`,
  formatPrice: () => "n/a",
  getDebtTokenConfig: (symbol: string) =>
    symbol === "GBPm"
      ? GBPm
      : {
          symbol,
          currencySymbol: symbol,
          currencyCode: symbol,
          locale: "en-US",
          collateralSymbol: "USDm",
        },
  useLoanDetails: () => null,
  useTroveData: () => ({
    data: mockTroveData,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: null,
  }),
}));

vi.mock("@repo/web3/wagmi", () => ({
  useChainId: () => 42220,
}));

vi.mock("./adjust-form", () => ({
  AdjustForm: () => <div data-testid="adjust-form" />,
}));

vi.mock("./close-form", () => ({
  CloseForm: () => <div data-testid="close-form" />,
}));

vi.mock("./rate-form", () => ({
  RateForm: () => <div data-testid="rate-form" />,
}));

vi.mock("../shared/trove-status-badge", () => ({
  TroveStatusBadge: () => <span data-testid="trove-status-badge" />,
}));

vi.mock("lucide-react", () => ({
  Check: () => <span>✓</span>,
  ChevronLeft: () => <span>‹</span>,
  Copy: () => <span>⎘</span>,
}));

import { ManageTroveView } from "./manage-trove-view";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ManageTroveView — token validation", () => {
  beforeEach(() => {
    mockSupportedDebtTokens = [GBPm];
    mockTroveData = null;
    mockIsLoading = false;
    mockIsError = false;
    pushMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the invalid-token error when token param is missing", async () => {
    render(<ManageTroveView troveId="0xabc" tokenSymbol={undefined} />);

    await waitFor(() => {
      expect(screen.getByText("Invalid borrow token")).toBeTruthy();
    });
  });

  it("shows the invalid-token error when token param is not supported on this chain", async () => {
    render(<ManageTroveView troveId="0xabc" tokenSymbol="EURm" />);

    await waitFor(() => {
      expect(screen.getByText("Invalid borrow token")).toBeTruthy();
    });
  });

  it("does NOT fall through to GBPm market when token is missing", async () => {
    // If the fallback were applied silently, the component would render
    // the normal trove view with GBPm — we expect the error card instead.
    render(<ManageTroveView troveId="0xabc" tokenSymbol={undefined} />);

    await waitFor(() => {
      expect(screen.queryByText("Adjust Position")).toBeNull();
      expect(screen.getByText("Invalid borrow token")).toBeTruthy();
    });
  });

  it("renders normally when a valid token is provided", async () => {
    mockIsLoading = true;
    render(<ManageTroveView troveId="0xabc" tokenSymbol="GBPm" />);

    await waitFor(() => {
      // Loading state shows skeletons — error card must NOT appear
      expect(screen.queryByText("Invalid borrow token")).toBeNull();
      expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    });
  });

  it("shows the error state when trove data fails to load", async () => {
    mockIsError = true;
    render(<ManageTroveView troveId="0xabc" tokenSymbol="GBPm" />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load trove")).toBeTruthy();
    });
  });

  it("includes a back-to-dashboard link on the invalid-token error card", async () => {
    render(<ManageTroveView troveId="0xabc" tokenSymbol={undefined} />);

    await waitFor(() => {
      const backButton = screen
        .getAllByRole("button")
        .find((b) => b.textContent?.includes("Back to Dashboard"));
      expect(backButton).toBeDefined();
    });
  });
});
