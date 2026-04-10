import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mutateMock = vi.fn();
const pushMock = vi.fn();

const GBPm = {
  symbol: "GBPm",
  currencySymbol: "£",
  currencyCode: "GBP",
  locale: "en-GB",
  collateralSymbol: "USDm",
};

const EURm = {
  symbol: "EURm",
  currencySymbol: "€",
  currencyCode: "EUR",
  locale: "de-DE",
  collateralSymbol: "USDm",
};

let mockSupportedDebtTokens = [GBPm];
let mockOwnerIndex: number | null = 0;
let mockOwnerIndexError = false;
let mockOwnerIndexFetching = false;
let mockUpfrontFee: bigint | null = 10n ** 16n;
let mockIsPending = false;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/stability-route", () => ({
  getSupportedDebtTokens: () => mockSupportedDebtTokens,
  getSupportedCollaterals: () => ["USDm"],
}));

vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: () => "0x0000000000000000000000000000000000000001",
}));

vi.mock("@repo/ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@repo/web3", () => ({
  getDebtTokenConfig: (symbol: string) => (symbol === "EURm" ? EURm : GBPm),
  tryParseUnits: (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return null;
    return BigInt(Math.round(num * 1e18));
  },
  useLoanDetails: () => null,
  useNextAvailableOwnerIndex: () => ({
    data: mockOwnerIndex,
    isError: mockOwnerIndexError,
    isFetching: mockOwnerIndexFetching,
  }),
  useOpenTrove: () => ({
    mutate: mutateMock,
    isPending: mockIsPending,
  }),
  usePredictUpfrontFee: () => ({
    data: mockUpfrontFee,
    isError: false,
    isFetching: false,
  }),
  useSystemParams: () => ({
    data: { minDebt: 10n ** 18n, minAnnualInterestRate: 0n },
  }),
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({
    address: "0x0000000000000000000000000000000000000001",
    isConnected: true,
  }),
  useChainId: () => 42220,
  useConfig: () => ({}),
  useReadContract: () => ({ data: 10n ** 22n }), // large collateral balance
}));

// Mock child components so each input surface is testable by label/testid.
vi.mock("./collateral-input", () => ({
  CollateralInput: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      data-testid="collateral-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("./debt-input", () => ({
  DebtInput: ({
    debtToken,
    value,
    onChange,
    onDebtTokenChange,
    debtTokenOptions,
  }: {
    debtToken: { symbol: string };
    value: string;
    onChange: (v: string) => void;
    onDebtTokenChange: (symbol: string) => void;
    debtTokenOptions: Array<{ symbol: string }>;
  }) => (
    <div>
      <input
        data-testid="debt-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {debtTokenOptions.map(({ symbol }) => (
        <button
          key={symbol}
          data-testid={`select-token-${symbol}`}
          onClick={() => onDebtTokenChange(symbol)}
        >
          {symbol}
        </button>
      ))}
      <span data-testid="selected-debt-token">{debtToken.symbol}</span>
    </div>
  ),
}));

vi.mock("./interest-rate-input", () => ({
  InterestRateInput: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      data-testid="interest-rate-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("./loan-summary", () => ({
  LoanSummary: () => <div data-testid="loan-summary" />,
}));

vi.mock("./ltv-bar", () => ({
  LTVBar: () => <div data-testid="ltv-bar" />,
}));

vi.mock("../shared/interest-rate-limits", () => ({
  MAX_INTEREST_RATE_PCT: 100,
  MAX_INTEREST_RATE_WAD: BigInt(10 ** 18),
}));

import { OpenTroveForm } from "./open-trove-form";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenTroveForm", () => {
  beforeEach(() => {
    mockSupportedDebtTokens = [GBPm, EURm];
    mockOwnerIndex = 0;
    mockOwnerIndexError = false;
    mockOwnerIndexFetching = false;
    mockUpfrontFee = 10n ** 16n;
    mockIsPending = false;
    mutateMock.mockReset();
    pushMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // Token switch: debt and rate reset, collateral preserved
  // -------------------------------------------------------------------------

  it("resets debt and interest rate but preserves collateral when switching debt token", async () => {
    render(<OpenTroveForm />);

    fireEvent.change(screen.getByTestId("collateral-input"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("debt-input"), {
      target: { value: "1000" },
    });
    fireEvent.change(screen.getByTestId("interest-rate-input"), {
      target: { value: "5" },
    });

    expect(
      (screen.getByTestId("collateral-input") as HTMLInputElement).value,
    ).toBe("5");
    expect((screen.getByTestId("debt-input") as HTMLInputElement).value).toBe(
      "1000",
    );
    expect(
      (screen.getByTestId("interest-rate-input") as HTMLInputElement).value,
    ).toBe("5");

    // Switch to EURm
    fireEvent.click(screen.getByTestId("select-token-EURm"));

    await waitFor(() => {
      expect(screen.getByTestId("selected-debt-token").textContent).toBe(
        "EURm",
      );
      // Debt and rate are cleared
      expect((screen.getByTestId("debt-input") as HTMLInputElement).value).toBe(
        "",
      );
      expect(
        (screen.getByTestId("interest-rate-input") as HTMLInputElement).value,
      ).toBe("");
      // Collateral is preserved
      expect(
        (screen.getByTestId("collateral-input") as HTMLInputElement).value,
      ).toBe("5");
    });
  });

  it("does not reset form when re-selecting the already active token", async () => {
    render(<OpenTroveForm />);

    fireEvent.change(screen.getByTestId("debt-input"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByTestId("interest-rate-input"), {
      target: { value: "7" },
    });

    // Re-select GBPm (already active)
    fireEvent.click(screen.getByTestId("select-token-GBPm"));

    await waitFor(() => {
      expect((screen.getByTestId("debt-input") as HTMLInputElement).value).toBe(
        "500",
      );
      expect(
        (screen.getByTestId("interest-rate-input") as HTMLInputElement).value,
      ).toBe("7");
    });
  });

  // -------------------------------------------------------------------------
  // Submit gating
  // -------------------------------------------------------------------------

  it("disables submit when inputs are empty", async () => {
    render(<OpenTroveForm />);

    // With no inputs, the label is "Enter collateral amount" (or similar). The
    // button must be disabled regardless of exact label text.
    await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      const submitButton = buttons.find(
        (b) =>
          b.textContent?.includes("Enter") ||
          b.textContent?.includes("Open Trove") ||
          b.textContent?.includes("Preparing"),
      );
      expect(submitButton).toBeDefined();
      expect(submitButton?.hasAttribute("disabled")).toBe(true);
    });
  });

  it("calls openTrove.mutate with correct symbol and params when all inputs are valid", async () => {
    render(<OpenTroveForm />);

    fireEvent.change(screen.getByTestId("collateral-input"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("debt-input"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("interest-rate-input"), {
      target: { value: "5" },
    });

    await waitFor(() => {
      const openButton = screen
        .getAllByRole("button")
        .find((b) => b.textContent === "Open Trove");
      expect(openButton).toBeDefined();
      expect(openButton?.hasAttribute("disabled")).toBe(false);
      fireEvent.click(openButton!);
    });

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledOnce();
      const call = mutateMock.mock.calls[0][0];
      expect(call.symbol).toBe("GBPm");
      expect(call.params.owner).toBe(
        "0x0000000000000000000000000000000000000001",
      );
      expect(call.params.ownerIndex).toBe(0);
      expect(call.params.boldAmount).toBeGreaterThan(0n);
      expect(call.params.collAmount).toBeGreaterThan(0n);
      expect(call.params.annualInterestRate).toBeGreaterThan(0n);
      expect(typeof call.params.maxUpfrontFee).toBe("bigint");
    });
  });

  it("disables submit while the trove mutation is pending", async () => {
    mockIsPending = true;
    render(<OpenTroveForm />);

    fireEvent.change(screen.getByTestId("collateral-input"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("debt-input"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("interest-rate-input"), {
      target: { value: "5" },
    });

    await waitFor(() => {
      const pendingButton = screen
        .getAllByRole("button")
        .find((b) => b.textContent === "Opening position...");
      expect(pendingButton).toBeDefined();
      expect(pendingButton?.hasAttribute("disabled")).toBe(true);
    });
  });

  it("disables submit when ownerIndex is unavailable due to an error", async () => {
    mockOwnerIndex = null;
    mockOwnerIndexError = true;
    render(<OpenTroveForm />);

    fireEvent.change(screen.getByTestId("collateral-input"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByTestId("debt-input"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("interest-rate-input"), {
      target: { value: "5" },
    });

    await waitFor(() => {
      const errorButton = screen
        .getAllByRole("button")
        .find((b) => b.textContent?.includes("Unable to prepare trove id"));
      expect(errorButton).toBeDefined();
      expect(errorButton?.hasAttribute("disabled")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Submit correctness with multi-token selection
  // -------------------------------------------------------------------------

  it("submits with the newly switched-to token's symbol after a token change", async () => {
    render(<OpenTroveForm />);

    // Fill collateral, then switch to EURm, then fill debt+rate
    fireEvent.change(screen.getByTestId("collateral-input"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByTestId("select-token-EURm"));

    await waitFor(() => {
      expect(screen.getByTestId("selected-debt-token").textContent).toBe(
        "EURm",
      );
    });

    fireEvent.change(screen.getByTestId("debt-input"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByTestId("interest-rate-input"), {
      target: { value: "5" },
    });

    await waitFor(() => {
      const openButton = screen
        .getAllByRole("button")
        .find((b) => b.textContent === "Open Trove");
      expect(openButton).toBeDefined();
      fireEvent.click(openButton!);
    });

    await waitFor(() => {
      expect(mutateMock).toHaveBeenCalledOnce();
      expect(mutateMock.mock.calls[0][0].symbol).toBe("EURm");
    });
  });
});
