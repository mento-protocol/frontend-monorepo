// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  build: vi.fn(),
  connected: true,
  execute: vi.fn(),
  fullError: false,
  fullLoading: false,
  fullPreview: undefined as unknown,
  handleSuccess: vi.fn(),
  isBuilding: false,
  rejected: false,
  setFlow: vi.fn(),
  switchChain: vi.fn(),
  toastError: vi.fn(),
  walletChainId: 42220,
  walletError: false,
  walletLoading: false,
  walletPreview: undefined as unknown,
}));

vi.mock("@mento-protocol/ui", () => ({
  Button: ({
    children,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => {
    void _size;
    return <button {...props}>{children}</button>;
  },
  TokenIcon: ({ token }: { token: { symbol: string } }) => (
    <span>{token.symbol}</span>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("jotai", () => ({ useSetAtom: () => mocks.setFlow }));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address, isConnected: mocks.connected }),
  useChainId: () => mocks.walletChainId,
  useConfig: () => ({}),
}));
vi.mock("@repo/web3", () => ({
  chainIdToChain: { 42220: { name: "Celo" } },
  liquidityFlowAtom: {},
  usePoolRebalancePreview: (
    _pool: unknown,
    _enabled: boolean,
    address?: string,
  ) =>
    address === undefined
      ? {
          data: mocks.fullPreview,
          isLoading: mocks.fullLoading,
          isError: mocks.fullError,
        }
      : {
          data: mocks.walletPreview,
          isLoading: mocks.walletLoading,
          isError: mocks.walletError,
        },
  useRebalanceTransaction: () => ({
    buildTransaction: mocks.build,
    handleSuccess: mocks.handleSuccess,
    isBuilding: mocks.isBuilding,
  }),
  executeLiquidityFlow: (...args: unknown[]) => mocks.execute(...args),
  getPoolDisplayOrder: (pool: {
    reserves: { token0Ratio: number };
    token0: unknown;
    token1: unknown;
  }) => ({
    displayToken0: pool.token0,
    displayToken1: pool.token1,
    displayRatio0: pool.reserves.token0Ratio,
  }),
  useSwitchChainWithFeedback: () => ({ switchToChain: mocks.switchChain }),
  isUserRejection: () => mocks.rejected,
}));

import { RebalancePanel } from "./rebalance-panel";

const pool = {
  poolAddr: "0xpool",
  chainId: 42220,
  token0: { address: "0xaaa", symbol: "CELO", decimals: 18 },
  token1: { address: "0xbbb", symbol: "USDm", decimals: 18 },
  reserves: { token0Ratio: 0.7 },
  priceAlignment: { priceDifferencePercent: -4.2 },
  pricing: { isPoolPriceAbove: true, deviationBps: 420 },
  rebalancing: {
    incentivePercent: 2,
    thresholdAboveBps: 500,
    thresholdBelowBps: 300,
  },
} as never;

function preview(overrides: Record<string, unknown> = {}) {
  return {
    inputToken: "0xaaa",
    outputToken: "0xbbb",
    amountRequired: { amount: 2_000n * 10n ** 18n },
    amountTransferred: { amount: 1_000_000n * 10n ** 18n },
    liquiditySourceIncentive: { amount: 1n },
    config: { lastRebalance: 0, rebalanceCooldown: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0x00000000000000000000000000000000000000aa",
    connected: true,
    fullError: false,
    fullLoading: false,
    fullPreview: preview(),
    isBuilding: false,
    rejected: false,
    walletChainId: 42220,
    walletError: false,
    walletLoading: false,
    walletPreview: preview(),
  });
  mocks.build.mockResolvedValue({
    approval: { params: { to: "0xaaa", data: "0xapprove" } },
    rebalance: { params: { to: "0xpool", data: "0xrebalance" } },
  });
  mocks.execute.mockResolvedValue({ success: false, txHashes: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RebalancePanel", () => {
  it("shows full and wallet preview loading states", () => {
    mocks.fullLoading = true;
    mocks.fullPreview = undefined;
    const { container, rerender } = render(<RebalancePanel pool={pool} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);

    mocks.fullLoading = false;
    mocks.fullPreview = preview();
    mocks.walletLoading = true;
    mocks.walletPreview = undefined;
    rerender(<RebalancePanel pool={pool} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("distinguishes preview failures from missing data", () => {
    mocks.fullError = true;
    const { rerender } = render(<RebalancePanel pool={pool} />);
    expect(
      screen.getByText("Failed to load rebalance data. Please try again."),
    ).toBeTruthy();

    mocks.fullError = false;
    mocks.fullPreview = undefined;
    mocks.walletPreview = undefined;
    mocks.walletError = true;
    rerender(<RebalancePanel pool={pool} />);
    expect(
      screen.getByText("Failed to load rebalance data. Please try again."),
    ).toBeTruthy();

    mocks.connected = false;
    mocks.address = undefined;
    mocks.walletError = false;
    rerender(<RebalancePanel pool={pool} />);
    expect(
      screen.getByText("No rebalance data available for this pool."),
    ).toBeTruthy();
  });

  it("renders a disconnected full preview and compact amounts", () => {
    mocks.connected = false;
    mocks.address = undefined;
    mocks.walletPreview = undefined;
    render(<RebalancePanel pool={pool} />);
    expect(screen.getByText("Required deposit")).toBeTruthy();
    expect(screen.getByText("2.00K")).toBeTruthy();
    expect(screen.getByText("1.00M")).toBeTruthy();
    expect(screen.getByText("<0.01")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Connect wallet to rebalance" }),
    ).toBeTruthy();
    expect(screen.getByText(/5.0% above oracle/)).toBeTruthy();
  });

  it("switches a connected wallet to the target chain", () => {
    mocks.walletChainId = 143;
    render(<RebalancePanel pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to Celo" }));
    expect(mocks.switchChain).toHaveBeenCalledWith(42220);
  });

  it("shows wallet-limited and wallet-ineligible explanations", () => {
    mocks.fullPreview = preview({
      amountRequired: { amount: 10n * 10n ** 18n },
    });
    mocks.walletPreview = preview({
      amountRequired: { amount: 2n * 10n ** 18n },
    });
    const { rerender } = render(<RebalancePanel pool={pool} />);
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          Boolean(element.textContent?.includes("With your current wallet")),
      ),
    ).toBeTruthy();
    expect(screen.getByText("From your current wallet balance")).toBeTruthy();

    mocks.walletPreview = undefined;
    rerender(<RebalancePanel pool={pool} />);
    expect(screen.getByText(/cannot contribute/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Need CELO to rebalance" }),
    ).toBeTruthy();
  });

  it("formats a below-oracle pool with unknown token addresses", () => {
    const belowPool = {
      ...(pool as object),
      chainId: 999,
      reserves: { token0Ratio: -1 },
      pricing: { isPoolPriceAbove: false, deviationBps: 250 },
      priceAlignment: { priceDifferencePercent: undefined },
      rebalancing: {
        incentivePercent: undefined,
        thresholdAboveBps: 0,
        thresholdBelowBps: 20_000,
      },
    } as never;
    mocks.fullPreview = preview({
      inputToken: "0xunknown",
      outputToken: "0xother",
    });
    mocks.walletPreview = mocks.fullPreview;
    mocks.walletChainId = 999;
    render(<RebalancePanel pool={belowPool} />);
    expect(screen.getAllByText("0xunkn...").length).toBeGreaterThan(0);
    expect(screen.getByText(/2.5% below oracle/)).toBeTruthy();
    expect(screen.getByText("0% CELO")).toBeTruthy();
  });

  it("blocks rebalance during cooldown and advances its timer", () => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    mocks.fullPreview = preview({
      config: { lastRebalance: 900, rebalanceCooldown: 4_000 },
    });
    mocks.walletPreview = mocks.fullPreview;
    render(<RebalancePanel pool={pool} />);
    expect(screen.getByRole("button", { name: /^Cooldown: 1h/ })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1_000));
  });

  it("executes approval and rebalance steps and reports success", async () => {
    const onComplete = vi.fn();
    mocks.execute.mockImplementation(async (...args: unknown[]) => {
      const steps = args[3] as Array<{ buildTx: () => Promise<unknown> }>;
      await Promise.all(steps.map((step) => step.buildTx()));
      return { success: true, txHashes: ["0xhash"] };
    });
    render(<RebalancePanel pool={pool} onRebalanceComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "Rebalance" }));
    await waitFor(() =>
      expect(mocks.handleSuccess).toHaveBeenCalledWith(
        "0xhash",
        mocks.walletPreview,
      ),
    );
    expect(onComplete).toHaveBeenCalled();
  });

  it("supports a no-approval transaction and no-op result", async () => {
    mocks.build.mockResolvedValue({
      rebalance: { params: { to: "0xpool", data: "0xrebalance" } },
    });
    render(<RebalancePanel pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "Rebalance" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    expect(mocks.handleSuccess).not.toHaveBeenCalled();
  });

  it("shows build errors and suppresses wallet rejection duplicates", async () => {
    mocks.build.mockRejectedValue(new Error("RPC unavailable"));
    const { rerender } = render(<RebalancePanel pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "Rebalance" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("RPC unavailable"),
    );

    mocks.toastError.mockClear();
    mocks.rejected = true;
    rerender(<RebalancePanel pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "Rebalance" }));
    await waitFor(() => expect(mocks.build).toHaveBeenCalledTimes(2));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
