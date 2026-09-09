// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { formatUnits, parseUnits } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolDisplay } from "@repo/web3";

const mocks = vi.hoisted(() => ({
  address: "0x00000000000000000000000000000000000000aa" as string | undefined,
  balance: 10n * 10n ** 18n,
  blockNumber: undefined as bigint | undefined,
  balancedBuild: null as unknown,
  balancedQuote: null as unknown,
  buildBalanced: vi.fn(),
  buildZap: vi.fn(),
  executeFlow: vi.fn(),
  invalidateQueries: vi.fn(),
  isBuilding: false,
  isQuoting: false,
  isUserRejection: false,
  isZapBuilding: false,
  isZapQuoting: false,
  onUpdated: vi.fn(),
  refetchBalance: vi.fn(),
  refetchQueries: vi.fn(),
  setFlow: vi.fn(),
  showSuccess: vi.fn(),
  toastError: vi.fn(),
  zapBuild: null as unknown,
  zapBuildError: null as string | null,
  zapQuote: null as unknown,
  zapQuoteError: null as unknown,
  zapQuoteIsError: false,
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
  CoinInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  TokenIcon: () => null,
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="slippage"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  toast: { error: mocks.toastError },
}));

vi.mock("@repo/web3", () => ({
  SLIPPAGE_OPTIONS: [0.3, 0.5, 1],
  useRemoveLiquidityQuote: () => ({
    data: mocks.balancedQuote,
    isFetching: mocks.isQuoting,
  }),
  useRemoveLiquidityTransaction: () => ({
    buildTransaction: mocks.buildBalanced,
    buildResult: mocks.balancedBuild,
    isBuilding: mocks.isBuilding,
  }),
  useZapOutQuote: () => ({
    data: mocks.zapQuote,
    isFetching: mocks.isZapQuoting,
    isError: mocks.zapQuoteIsError,
    error: mocks.zapQuoteError,
  }),
  useZapOutTransaction: () => ({
    buildTransaction: mocks.buildZap,
    buildResult: mocks.zapBuild,
    buildError: mocks.zapBuildError,
    isBuilding: mocks.isZapBuilding,
  }),
  ConnectButton: ({ text }: { text: string }) => <button>{text}</button>,
  tryParseUnits: (value: string, decimals: number) => {
    if (!value) return null;
    try {
      return parseUnits(value, decimals);
    } catch {
      return null;
    }
  },
  formatCompactBalance: (value: string) => value,
  executeLiquidityFlow: (...args: unknown[]) => mocks.executeFlow(...args),
  liquidityFlowAtom: {},
  showLiquiditySuccessToast: (...args: unknown[]) => mocks.showSuccess(...args),
  getPoolDisplayOrder: (pool: PoolDisplay) => ({
    displayToken0: pool.token0,
    displayToken1: pool.token1,
    isSwapped: pool.poolAddr.endsWith("2"),
  }),
  isUserRejection: () => mocks.isUserRejection,
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address }),
  useConfig: () => ({ test: true }),
  useBlockNumber: () => ({ data: mocks.blockNumber }),
  useReadContract: () => ({
    data: mocks.balance,
    refetch: mocks.refetchBalance,
  }),
}));

vi.mock("jotai", () => ({ useSetAtom: () => mocks.setFlow }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    refetchQueries: mocks.refetchQueries,
  }),
}));

import { RemoveLiquidityForm } from "./remove-liquidity-form";

const pool: PoolDisplay = {
  poolAddr: "0x0000000000000000000000000000000000000001",
  chainId: 42220,
  poolType: "FPMM",
  token0: {
    address: "0x0000000000000000000000000000000000000010",
    symbol: "CELO",
    decimals: 18,
    name: "Celo",
  },
  token1: {
    address: "0x0000000000000000000000000000000000000020",
    symbol: "USDm",
    decimals: 18,
    name: "Dollar",
  },
  reserves: {
    token0: "10",
    token1: "20",
    token0Ratio: 0.5,
    hasLiquidity: true,
  },
  fees: { total: 0.3, lp: 0.2, protocol: 0.1, label: "fee" },
  priceAlignment: { status: "in-band" },
  tvl: 30,
};

const balancedBuild = {
  approval: { params: { to: pool.poolAddr, data: "0xapprove" } },
  removeLiquidity: { params: { to: pool.poolAddr, data: "0xremove" } },
};
const zapBuild = {
  approval: { params: { to: pool.poolAddr, data: "0xapprove" } },
  zapOut: {
    estimatedMinTokenOut: parseUnits("2", 18),
    params: { to: pool.poolAddr, data: "0xzap" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0x00000000000000000000000000000000000000aa",
    balance: parseUnits("10", 18),
    blockNumber: undefined,
    balancedBuild: null,
    balancedQuote: null,
    isBuilding: false,
    isQuoting: false,
    isUserRejection: false,
    isZapBuilding: false,
    isZapQuoting: false,
    zapBuild: null,
    zapBuildError: null,
    zapQuote: null,
    zapQuoteError: null,
    zapQuoteIsError: false,
  });
  mocks.refetchBalance.mockResolvedValue({ data: mocks.balance });
  mocks.buildBalanced.mockResolvedValue(balancedBuild);
  mocks.buildZap.mockResolvedValue(zapBuild);
  mocks.executeFlow.mockResolvedValue({ success: false, txHashes: [] });
});

afterEach(cleanup);

function enterAmount(value: string) {
  fireEvent.change(screen.getByLabelText("LP token amount to burn"), {
    target: { value },
  });
}

describe("RemoveLiquidityForm", () => {
  it("shows wallet connection and the empty balanced summary", () => {
    mocks.address = undefined;
    render(<RemoveLiquidityForm pool={pool} header={<h1>Remove</h1>} />);
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeTruthy();
    expect(screen.getAllByText("0.0000")).toHaveLength(2);
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  it("reports wrong network and prevents amount presets when disabled", () => {
    render(<RemoveLiquidityForm pool={pool} disabled />);
    expect(
      (
        screen.getByRole("button", {
          name: "Wrong network",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Max" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("uses fractional and maximum LP balance presets", () => {
    render(<RemoveLiquidityForm pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(
      (screen.getByLabelText("LP token amount to burn") as HTMLInputElement)
        .value,
    ).toBe("2.5");
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(
      (screen.getByLabelText("LP token amount to burn") as HTMLInputElement)
        .value,
    ).toBe("10");
  });

  it("ignores presets when the LP balance is unavailable", () => {
    mocks.balance = undefined as never;
    render(<RemoveLiquidityForm pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "50%" }));
    expect(
      (screen.getByLabelText("LP token amount to burn") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("shows invalid, insufficient, quoting, and building balanced states", async () => {
    const { rerender } = render(<RemoveLiquidityForm pool={pool} />);
    expect(screen.getByRole("button", { name: "Enter amount" })).toBeTruthy();
    enterAmount("11");
    expect(screen.getByText("Insufficient LP token balance")).toBeTruthy();

    mocks.balance = parseUnits("20", 18);
    mocks.isQuoting = true;
    rerender(<RemoveLiquidityForm pool={pool} />);
    expect(screen.getByRole("button", { name: "Preparing..." })).toBeTruthy();
    mocks.isQuoting = false;
    mocks.isBuilding = true;
    rerender(<RemoveLiquidityForm pool={pool} />);
    expect(screen.getByRole("button", { name: "Preparing..." })).toBeTruthy();
  });

  it("builds and executes a balanced removal with approval", async () => {
    mocks.balancedQuote = {
      amount0: parseUnits("1", 18),
      amount1: parseUnits("2", 18),
    };
    mocks.balancedBuild = balancedBuild;
    mocks.executeFlow.mockImplementation(async (...args: unknown[]) => {
      const steps = args[3] as Array<{ buildTx: () => Promise<unknown> }>;
      await Promise.all(steps.map((step) => step.buildTx()));
      return { success: true, txHashes: ["0xhash"] };
    });
    render(
      <RemoveLiquidityForm pool={pool} onLiquidityUpdated={mocks.onUpdated} />,
    );
    enterAmount("1");
    await waitFor(() => expect(mocks.buildBalanced).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Remove Liquidity" }));

    await waitFor(() => expect(mocks.executeFlow).toHaveBeenCalled());
    expect(mocks.showSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ action: "removed", txHash: "0xhash" }),
    );
    expect(mocks.onUpdated).toHaveBeenCalledWith("0xhash");
    expect(mocks.invalidateQueries).toHaveBeenCalled();
  });

  it("reports a stale balance before transaction execution", async () => {
    mocks.balancedQuote = { amount0: 1n, amount1: 1n };
    mocks.balancedBuild = balancedBuild;
    mocks.refetchBalance.mockResolvedValue({ data: parseUnits("0.5", 18) });
    render(<RemoveLiquidityForm pool={pool} />);
    enterAmount("1");
    fireEvent.click(screen.getByRole("button", { name: "Remove Liquidity" }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Something went wrong. Please try again.",
      ),
    );
    expect(mocks.executeFlow).not.toHaveBeenCalled();
  });

  it.each([
    [
      new Error("no viable zap-out route"),
      "No single-token route is available for this amount. Try a smaller amount or use balanced mode.",
      "Route unavailable",
    ],
    [
      "provider unavailable",
      "Unable to quote single-token removal right now.",
      "Quote unavailable",
    ],
  ])("maps single-token quote failures", async (error, message, buttonText) => {
    mocks.zapQuoteIsError = true;
    mocks.zapQuoteError = error;
    render(<RemoveLiquidityForm pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "Single token" }));
    enterAmount("1");
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole("button", { name: buttonText })).toBeTruthy();
  });

  it("selects a single output token and executes a fresh zap-out flow", async () => {
    mocks.zapQuote = { estimatedMinTokenOut: parseUnits("1", 18) };
    mocks.zapBuild = zapBuild;
    mocks.executeFlow.mockImplementation(async (...args: unknown[]) => {
      const steps = args[3] as Array<{ buildTx: () => Promise<unknown> }>;
      await Promise.all(steps.map((step) => step.buildTx()));
      return { success: true, txHashes: ["0xzap-hash"] };
    });
    render(<RemoveLiquidityForm pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "Single token" }));
    fireEvent.click(screen.getByRole("button", { name: "USDm" }));
    enterAmount("1");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove as USDm" }),
      ).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText("slippage"), {
      target: { value: "0.5" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove as USDm" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove as USDm" }));
    await waitFor(() => expect(mocks.executeFlow).toHaveBeenCalled());
    expect(mocks.showSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "0xzap-hash" }),
    );
  });

  it("reports a missing fresh zap route and suppresses wallet rejection errors", async () => {
    mocks.zapQuote = { estimatedMinTokenOut: 1n };
    mocks.zapBuild = zapBuild;
    mocks.buildZap.mockResolvedValueOnce(zapBuild).mockResolvedValueOnce(null);
    mocks.isUserRejection = true;
    render(<RemoveLiquidityForm pool={pool} />);
    fireEvent.click(screen.getByRole("button", { name: "Single token" }));
    enterAmount("1");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove as CELO" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove as CELO" }));
    await waitFor(() => expect(mocks.buildZap).toHaveBeenCalledTimes(2));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("refetches the LP balance on a new block", async () => {
    mocks.blockNumber = 5n;
    render(<RemoveLiquidityForm pool={pool} />);
    await waitFor(() => expect(mocks.refetchBalance).toHaveBeenCalled());
    expect(formatUnits(mocks.balance, 18)).toBe("10");
  });
});
