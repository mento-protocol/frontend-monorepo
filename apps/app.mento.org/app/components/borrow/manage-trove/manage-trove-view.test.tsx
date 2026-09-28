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

const OWNER = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const OTHER_ACCOUNT = "0x9999999999999999999999999999999999999999";

let mockOwner: string | undefined = undefined;
let mockOwnerIsPending = false;
let mockOwnerIsError = false;
let mockAccount: string | undefined = undefined;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/stability-route", () => ({
  getSupportedDebtTokens: () => mockSupportedDebtTokens,
}));

vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => undefined,
}));

vi.mock("@mento-protocol/ui", () => ({
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
  getExplorerUrl: () => "https://explorer.test",
  isTroveOwner: (owner?: string, account?: string) =>
    !!owner && !!account && owner.toLowerCase() === account.toLowerCase(),
  shortenAddress: (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-4)}`,
  useLoanDetails: () => null,
  useTroveData: () => ({
    data: mockTroveData,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: null,
  }),
  useTroveOwner: () => ({
    data: mockOwner,
    isPending: mockOwnerIsPending,
    isError: mockOwnerIsError,
  }),
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mockAccount }),
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

vi.mock("./trove-activity-panel", () => ({
  TroveActivityPanel: () => <div data-testid="trove-activity-panel" />,
}));

vi.mock("../shared/trove-status-badge", () => ({
  TroveStatusBadge: () => <span data-testid="trove-status-badge" />,
}));

vi.mock("lucide-react", () => ({
  AlertOctagon: () => <span />,
  ArrowDownToLine: () => <span />,
  Check: () => <span>✓</span>,
  ChevronLeft: () => <span>‹</span>,
  Clock: () => <span />,
  Copy: () => <span>⎘</span>,
  ExternalLink: () => <span />,
  Filter: () => <span />,
  MinusCircle: () => <span />,
  Percent: () => <span />,
  PlusCircle: () => <span />,
  TrendingDown: () => <span />,
  TrendingUp: () => <span />,
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
    mockOwner = undefined;
    mockOwnerIsPending = false;
    mockOwnerIsError = false;
    mockAccount = undefined;
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

  it("renders the trove ID copy control with an accessible touch target", async () => {
    mockTroveData = {
      status: "active",
      collateral: 1n,
      debt: 1n,
      annualInterestRate: 1n,
    };

    render(<ManageTroveView troveId="0xabc123456789" tokenSymbol="GBPm" />);

    const copyButton = await screen.findByRole("button", {
      name: "Copy trove ID",
    });

    expect(copyButton.classList.contains("h-6")).toBe(true);
    expect(copyButton.classList.contains("w-6")).toBe(true);
  });
});

describe("ManageTroveView — owner-only management", () => {
  const FORM_TEST_IDS = ["adjust-form", "rate-form", "close-form"];

  function expectFormsRendered(rendered: boolean) {
    for (const testId of FORM_TEST_IDS) {
      if (rendered) {
        expect(screen.getByTestId(testId)).toBeTruthy();
      } else {
        expect(screen.queryByTestId(testId)).toBeNull();
      }
    }
  }

  function renderView() {
    render(<ManageTroveView troveId="0xabc123456789" tokenSymbol="GBPm" />);
  }

  beforeEach(() => {
    mockSupportedDebtTokens = [GBPm];
    mockTroveData = {
      status: "active",
      collateral: 1n,
      debt: 1n,
      annualInterestRate: 1n,
    };
    mockIsLoading = false;
    mockIsError = false;
    mockOwner = OWNER;
    mockOwnerIsPending = false;
    mockOwnerIsError = false;
    mockAccount = OWNER;
    pushMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("(a) shows a placeholder and no management tab while the owner is loading", () => {
    mockOwner = undefined;
    mockOwnerIsPending = true;

    renderView();

    expectFormsRendered(false);
    expect(screen.queryByText("Adjust Position")).toBeNull();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("(b) shows the closed notice when the status is not active or zombie", () => {
    mockTroveData = {
      status: "closedByOwner",
      collateral: 0n,
      debt: 0n,
      annualInterestRate: 0n,
    };
    mockOwner = undefined;
    mockOwnerIsError = true;

    renderView();

    expectFormsRendered(false);
    expect(
      screen.getByText("This position is closed and can no longer be managed."),
    ).toBeTruthy();
  });

  it("(c) shows the unconfirmed-owner notice when the owner lookup fails", () => {
    mockOwner = undefined;
    mockOwnerIsError = true;

    renderView();

    expectFormsRendered(false);
    expect(
      screen.getByText(/The owner of this position couldn.t be confirmed/),
    ).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  it("(d) asks for the owner's wallet when no wallet is connected", () => {
    mockAccount = undefined;

    renderView();

    expectFormsRendered(false);
    expect(
      screen.getByText("Connect the owner's wallet to manage this position."),
    ).toBeTruthy();
  });

  it("(e) shows the stats read-only with the owner when another wallet is connected", () => {
    mockAccount = OTHER_ACCOUNT;

    renderView();

    expectFormsRendered(false);
    expect(
      screen.getByText(/Only the owner.s wallet can manage it/),
    ).toBeTruthy();
    expect(screen.getByText("Collateral")).toBeTruthy();

    const ownerLinks = screen
      .getAllByRole("link")
      .filter(
        (link) =>
          link.getAttribute("href") ===
          `https://explorer.test/address/${OWNER}`,
      );
    expect(ownerLinks.length).toBe(2);
    for (const link of ownerLinks) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("(f) renders the management tabs when the connected wallet is the owner", () => {
    renderView();

    expectFormsRendered(true);
    expect(screen.getByText("Adjust Position")).toBeTruthy();
  });

  it("(f) renders the management tabs for a zombie trove owned by the connected wallet", () => {
    mockTroveData = {
      status: "zombie",
      collateral: 1n,
      debt: 1n,
      annualInterestRate: 1n,
    };

    renderView();

    expectFormsRendered(true);
  });

  it("matches the owner and the connected wallet regardless of address case", () => {
    mockOwner = OWNER.toLowerCase();
    mockAccount = `0x${OWNER.slice(2).toUpperCase()}`;

    renderView();

    expectFormsRendered(true);
  });
});
