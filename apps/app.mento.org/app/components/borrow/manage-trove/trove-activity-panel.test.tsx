import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TroveOperation } from "@repo/web3";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GBPm = {
  symbol: "GBPm",
  currencySymbol: "£",
  currencyCode: "GBP",
  locale: "en-GB",
  collateralSymbol: "USDm",
};

const baseOp = {
  collIncreaseFromRedist: 0n,
  debtIncreaseFromRedist: 0n,
  upfrontFee: 0n,
  redemptionPrice: null,
  liquidationPrice: null,
  newCollateral: 1_000n * 10n ** 18n,
  newDebt: 500n * 10n ** 18n,
  newInterestRate: 60_000_000_000_000_000n, // 6%
  blockNumber: 1_000n,
  timestamp: Math.floor(Date.now() / 1000) - 3 * 86400, // 3 days ago
  transactionHash:
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  initiator: "0x1111111111111111111111111111111111111111",
};

function op(
  partial: Partial<TroveOperation> & {
    id: string;
    operation: TroveOperation["operation"];
    collateralDelta: bigint;
    debtDelta: bigint;
  },
): TroveOperation {
  return { ...baseOp, ...partial } as TroveOperation;
}

// ---------------------------------------------------------------------------
// Mock state — mutated per test
// ---------------------------------------------------------------------------

interface MockQuery {
  data?: { pages: TroveOperation[][] };
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isUnsupportedChain: boolean;
  fetchNextPage: () => void;
}

const baseQuery: MockQuery = {
  data: undefined,
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  isUnsupportedChain: false,
  fetchNextPage: vi.fn(),
};

let mockQuery: MockQuery = { ...baseQuery };

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@repo/ui", () => ({
  Card: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  ),
  CardContent: ({
    children,
    ...rest
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="skeleton" {...props} />
  ),
}));

vi.mock("@repo/web3", () => ({
  formatCollateralAmount: (amount: bigint, symbol: string) => {
    const divisor = 10n ** 18n;
    return `${amount / divisor}.00 ${symbol}`;
  },
  formatDebtAmount: (amount: bigint, token: { symbol: string }) => {
    const divisor = 10n ** 18n;
    return `${amount / divisor}.00 ${token.symbol}`;
  },
  formatInterestRate: (rate: bigint) => `${Number(rate) / 1e16}%`,
  useExplorerUrl: () => "https://example-explorer.test",
  useTroveOperations: () => mockQuery,
}));

vi.mock("lucide-react", () => ({
  AlertOctagon: () => <span data-testid="icon-alert" />,
  ArrowDownToLine: () => <span data-testid="icon-arrow-down" />,
  Clock: () => <span data-testid="icon-clock" />,
  ExternalLink: () => <span data-testid="icon-external" />,
  Filter: () => <span data-testid="icon-filter" />,
  MinusCircle: () => <span data-testid="icon-minus" />,
  Percent: () => <span data-testid="icon-percent" />,
  PlusCircle: () => <span data-testid="icon-plus" />,
  TrendingDown: () => <span data-testid="icon-trending-down" />,
  TrendingUp: () => <span data-testid="icon-trending-up" />,
}));

import { TroveActivityPanel } from "./trove-activity-panel";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function renderPanel() {
  return render(
    <TroveActivityPanel
      troveId="0xabc"
      debtToken={GBPm}
      collateralSymbol="USDm"
    />,
  );
}

beforeEach(() => {
  mockQuery = { ...baseQuery, fetchNextPage: vi.fn() };
});

afterEach(() => {
  cleanup();
});

describe("TroveActivityPanel — state matrix", () => {
  it("renders the unsupported-chain message when no subgraph is configured for the chain", () => {
    mockQuery = { ...baseQuery, isUnsupportedChain: true };
    renderPanel();
    expect(
      screen.getByText(/Trove history isn['’]t indexed on this network yet\./i),
    ).toBeTruthy();
    // The empty-history message must NOT show — that's the false negative the
    // reviewer caught.
    expect(
      screen.queryByText(/No on-chain activity yet for this trove\./i),
    ).toBeNull();
  });

  it("renders a loading skeleton during the initial fetch", () => {
    mockQuery = { ...baseQuery, isLoading: true };
    renderPanel();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders the skeleton (not the empty-history message) while the hook reports isLoading — covers the TroveManager-resolution window where the operations query is still disabled", () => {
    // Hook is loading but data is undefined (operations query never started
    // because the on-chain TroveManager resolution hasn't returned). Before
    // the hook fix, isLoading would be `false` here and the component
    // collapsed into "No on-chain activity yet for this trove."
    mockQuery = { ...baseQuery, isLoading: true, data: undefined };
    renderPanel();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/No on-chain activity yet for this trove\./i),
    ).toBeNull();
  });

  it("renders the error state when the query fails", () => {
    mockQuery = { ...baseQuery, isError: true };
    renderPanel();
    expect(screen.getByText(/Could not load trove history/i)).toBeTruthy();
  });

  it("renders the empty-history message when the chain is supported but the trove has zero events", () => {
    mockQuery = { ...baseQuery, data: { pages: [[]] } };
    renderPanel();
    expect(
      screen.getByText(/No on-chain activity yet for this trove\./i),
    ).toBeTruthy();
  });
});

describe("TroveActivityPanel — operation kind rendering", () => {
  it("renders redeemCollateral as 'Redeemed against' with a linked initiator", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "1",
              operation: "redeemCollateral",
              collateralDelta: -100n * 10n ** 18n,
              debtDelta: -50n * 10n ** 18n,
              redemptionPrice: 740_000_000_000_000_000n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Redeemed against")).toBeTruthy();
    expect(screen.getByText(/Redeemed by/)).toBeTruthy();
    expect(
      screen.getByText(/Redemption price: 0\.7400 GBPm\/USDm/),
    ).toBeTruthy();
  });

  it("renders adjustTrove with positive collateral delta as 'Collateral added'", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "2",
              operation: "adjustTrove",
              collateralDelta: 100n * 10n ** 18n,
              debtDelta: 0n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Collateral added")).toBeTruthy();
  });

  it("renders adjustTrove with negative collateral delta as 'Collateral removed'", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "3",
              operation: "adjustTrove",
              collateralDelta: -100n * 10n ** 18n,
              debtDelta: 0n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Collateral removed")).toBeTruthy();
  });

  it("renders adjustTrove with positive debt delta only as 'Borrowed more'", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "4",
              operation: "adjustTrove",
              collateralDelta: 0n,
              debtDelta: 50n * 10n ** 18n,
              upfrontFee: 1n * 10n ** 18n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Borrowed more")).toBeTruthy();
    expect(screen.getByText(/Upfront fee: 1\.00 GBPm/)).toBeTruthy();
  });

  it("renders adjustTrove with negative debt delta only as 'Repaid debt'", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "5",
              operation: "adjustTrove",
              collateralDelta: 0n,
              debtDelta: -25n * 10n ** 18n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Repaid debt")).toBeTruthy();
  });

  it("renders adjustTroveInterestRate as 'Interest rate changed'", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "6",
              operation: "adjustTroveInterestRate",
              collateralDelta: 0n,
              debtDelta: 0n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Interest rate changed")).toBeTruthy();
  });

  it("renders applyPendingDebt as 'Interest applied'", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "7",
              operation: "applyPendingDebt",
              collateralDelta: 0n,
              debtDelta: 1n * 10n ** 18n,
              debtIncreaseFromRedist: 1n * 10n ** 18n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Interest applied")).toBeTruthy();
  });

  it("renders liquidate with non-zero post-debt as 'Partially liquidated'", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "8",
              operation: "liquidate",
              collateralDelta: -200n * 10n ** 18n,
              debtDelta: -100n * 10n ** 18n,
              newDebt: 50n * 10n ** 18n, // non-zero → partial
              liquidationPrice: 1_800_000_000_000_000_000n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Partially liquidated")).toBeTruthy();
    expect(
      screen.getByText(/Liquidation price: 1\.8000 GBPm\/USDm/),
    ).toBeTruthy();
  });

  it("renders liquidate with zero post-debt as 'Liquidated' (full)", () => {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "9",
              operation: "liquidate",
              collateralDelta: -1_000n * 10n ** 18n,
              debtDelta: -500n * 10n ** 18n,
              newDebt: 0n,
              newCollateral: 0n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    expect(screen.getByText("Liquidated")).toBeTruthy();
  });
});

describe("TroveActivityPanel — filter pills", () => {
  function mountWithMixedOperations() {
    mockQuery = {
      ...baseQuery,
      data: {
        pages: [
          [
            op({
              id: "a",
              operation: "redeemCollateral",
              collateralDelta: -10n * 10n ** 18n,
              debtDelta: -5n * 10n ** 18n,
            }),
            op({
              id: "b",
              operation: "adjustTrove",
              collateralDelta: 100n * 10n ** 18n,
              debtDelta: 0n,
            }),
            op({
              id: "c",
              operation: "adjustTroveInterestRate",
              collateralDelta: 0n,
              debtDelta: 0n,
            }),
          ],
        ],
      },
    };
    renderPanel();
  }

  it("renders all 7 filter pills inside an accessible group with the 'All' pill pressed by default", () => {
    mountWithMixedOperations();
    const group = screen.getByRole("group", {
      name: /Filter trove activity by type/i,
    });
    const pills = group.querySelectorAll("button[aria-pressed]");
    expect(pills.length).toBe(7);

    const all = screen.getByRole("button", { name: /^All filter$/i });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    for (const id of [
      "Redemptions",
      "Liquidations",
      "Collateral",
      "Debt",
      "Rate",
      "Interest",
    ]) {
      const pill = screen.getByRole("button", {
        name: new RegExp(`^${id} filter$`, "i"),
      });
      expect(pill.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("clicking a filter pill flips its aria-pressed state and narrows the visible rows", () => {
    mountWithMixedOperations();
    // Initially: all 3 rows visible.
    expect(screen.getByText("Redeemed against")).toBeTruthy();
    expect(screen.getByText("Collateral added")).toBeTruthy();
    expect(screen.getByText("Interest rate changed")).toBeTruthy();

    const redemptions = screen.getByRole("button", {
      name: /^Redemptions filter$/i,
    });
    fireEvent.click(redemptions);

    expect(redemptions.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /^All filter$/i })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    // Only the redemption row remains.
    expect(screen.getByText("Redeemed against")).toBeTruthy();
    expect(screen.queryByText("Collateral added")).toBeNull();
    expect(screen.queryByText("Interest rate changed")).toBeNull();
  });

  it("shows the filter-mismatch empty state (not the empty-history state) when the active filter has no matches", () => {
    mountWithMixedOperations();
    const liquidations = screen.getByRole("button", {
      name: /^Liquidations filter$/i,
    });
    fireEvent.click(liquidations);

    expect(
      screen.getByText(/No matching events for the selected filter\./i),
    ).toBeTruthy();
    expect(
      screen.queryByText(/No on-chain activity yet for this trove\./i),
    ).toBeNull();
  });
});

describe("TroveActivityPanel — pagination", () => {
  it("renders the 'Load earlier events' button when hasNextPage is true", () => {
    const fetchNextPage = vi.fn();
    mockQuery = {
      ...baseQuery,
      hasNextPage: true,
      fetchNextPage,
      data: {
        pages: [
          [
            op({
              id: "p1",
              operation: "redeemCollateral",
              collateralDelta: -1n * 10n ** 18n,
              debtDelta: -1n * 10n ** 18n,
            }),
          ],
        ],
      },
    };
    renderPanel();
    const button = screen.getByRole("button", { name: /Load earlier events/i });
    fireEvent.click(button);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
