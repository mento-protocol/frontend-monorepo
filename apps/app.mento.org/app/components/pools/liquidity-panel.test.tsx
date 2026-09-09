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
  address: "0xabc" as string | undefined,
  balance: undefined as bigint | undefined,
  blockNumber: undefined as bigint | undefined,
  position: undefined as unknown,
  receipt: null as null | {
    logs: Array<{ address: string; data: string; topics: string[] }>;
  },
  refetchBalance: vi.fn(),
  waitReceipt: vi.fn(),
}));

vi.mock("@mento-protocol/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TokenIcon: ({ token }: { token: { symbol: string } }) => (
    <span>{token.symbol}</span>
  ),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));
vi.mock("./add-liquidity-form", () => ({
  AddLiquidityForm: ({
    header,
    onLiquidityUpdated,
    disabled,
  }: {
    header: React.ReactNode;
    onLiquidityUpdated: (hash?: string) => Promise<void>;
    disabled?: boolean;
  }) => (
    <div>
      {header}
      <span>add form {String(disabled)}</span>
      <button onClick={() => void onLiquidityUpdated("0xhash")}>
        refresh add
      </button>
      <button onClick={() => void onLiquidityUpdated()}>
        refresh without hash
      </button>
    </div>
  ),
}));
vi.mock("./remove-liquidity-form", () => ({
  RemoveLiquidityForm: ({
    header,
    onLiquidityUpdated,
  }: {
    header: React.ReactNode;
    onLiquidityUpdated: (hash?: string) => Promise<void>;
  }) => (
    <div>
      {header}
      <span>remove form</span>
      <button onClick={() => void onLiquidityUpdated("0xhash")}>
        refresh remove
      </button>
    </div>
  ),
}));
vi.mock("./pool-fee-popover", () => ({
  PoolFeePopover: () => <span>fee details</span>,
}));
vi.mock("./user-position-card", () => ({
  UserPositionCard: ({ lpBalance }: { lpBalance?: bigint }) => (
    <span>position {String(lpBalance)}</span>
  ),
}));
vi.mock("@repo/web3", () => ({
  getPoolDisplayOrder: (pool: {
    reserves: { token0: unknown; token1: unknown };
    token0: unknown;
    token1: unknown;
  }) => ({
    displayToken0: pool.token0,
    displayToken1: pool.token1,
    displayReserve0: pool.reserves.token0,
    displayReserve1: pool.reserves.token1,
  }),
  useExplorerUrl: (chainId: number) => `https://explorer/${chainId}`,
  useUserPosition: () => ({ data: mocks.position }),
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ address: mocks.address }),
  useReadContract: () => ({
    data: mocks.balance,
    refetch: mocks.refetchBalance,
  }),
  useBlockNumber: () => ({ data: mocks.blockNumber }),
  useConfig: () => ({}),
  waitForTransactionReceipt: (...args: unknown[]) => mocks.waitReceipt(...args),
}));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    decodeEventLog: ({ data }: { data: string }) => {
      if (data === "throw") throw new Error("not an ERC20 log");
      if (data === "other") return { eventName: "Approval", args: {} };
      if (data === "receive")
        return {
          eventName: "Transfer",
          args: { from: "0xother", to: "0xabc", value: 4n },
        };
      return {
        eventName: "Transfer",
        args: { from: "0xabc", to: "0xother", value: 2n },
      };
    },
  };
});

import { LiquidityPanel } from "./liquidity-panel";

const makePool = (overrides: Record<string, unknown> = {}) =>
  ({
    poolAddr: "0xpool",
    chainId: 42220,
    poolType: "FPMM",
    token0: { address: "0xaaa", symbol: "CELO" },
    token1: { address: "0xbbb", symbol: "USDm" },
    reserves: { token0: "10", token1: "20" },
    fees: { lp: 0.2 },
    tvl: 1234,
    ...overrides,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks, {
    address: "0xabc",
    balance: undefined,
    blockNumber: undefined,
    position: undefined,
    receipt: null,
  });
  mocks.refetchBalance.mockResolvedValue({ data: mocks.balance });
  mocks.waitReceipt.mockImplementation(async () => mocks.receipt);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LiquidityPanel", () => {
  it("renders deposit mode, closes, and disables unavailable removal", () => {
    const onClose = vi.fn();
    render(
      <LiquidityPanel
        pool={makePool()}
        mode="deposit"
        onClose={onClose}
        disabled
        chainId={143}
      />,
    );
    expect(screen.getByText("add form true")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Remove Liquidity",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: /Explorer/ }).getAttribute("href"),
    ).toBe("https://explorer/143/address/0xpool");
    fireEvent.click(screen.getByRole("button", { name: "Back to Pools" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows legacy and missing TVL presentation with a custom back label", () => {
    render(
      <LiquidityPanel
        pool={makePool({ poolType: "Legacy", tvl: null })}
        mode="deposit"
        onClose={vi.fn()}
        backLabel="Return"
      />,
    );
    expect(screen.getByText("LEGACY")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Return" })).toBeTruthy();
  });

  it("opens removal for an LP holder and shows the position", () => {
    mocks.balance = 10n;
    mocks.position = { share: 1 };
    render(
      <LiquidityPanel pool={makePool()} mode="manage" onClose={vi.fn()} />,
    );
    expect(screen.getByText("remove form")).toBeTruthy();
    expect(screen.getByText("position 10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Liquidity" }));
    expect(screen.getByText(/add form/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Liquidity" }));
    expect(screen.getByText("remove form")).toBeTruthy();
  });

  it("returns manage mode to add when the balance disappears", () => {
    mocks.balance = 10n;
    const { rerender } = render(
      <LiquidityPanel pool={makePool()} mode="manage" onClose={vi.fn()} />,
    );
    expect(screen.getByText("remove form")).toBeTruthy();
    mocks.balance = 0n;
    rerender(
      <LiquidityPanel pool={makePool()} mode="manage" onClose={vi.fn()} />,
    );
    expect(screen.getByText(/add form/)).toBeTruthy();
  });

  it("applies received and sent LP transfers from a transaction receipt", async () => {
    mocks.balance = 10n;
    mocks.position = { share: 1 };
    mocks.receipt = {
      logs: [
        { address: "0xother", data: "receive", topics: [] },
        { address: "0xpool", data: "throw", topics: [] },
        { address: "0xpool", data: "other", topics: [] },
        { address: "0xpool", data: "receive", topics: [] },
        { address: "0xpool", data: "send", topics: [] },
      ],
    };
    mocks.refetchBalance.mockResolvedValue({ data: 12n });
    render(
      <LiquidityPanel pool={makePool()} mode="deposit" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "refresh add" }));
    await waitFor(() => expect(screen.getByText("position 12")).toBeTruthy());
    expect(mocks.waitReceipt).toHaveBeenCalled();
  });

  it("clamps a negative optimistic LP balance to zero", async () => {
    mocks.balance = 1n;
    mocks.receipt = { logs: [{ address: "0xpool", data: "send", topics: [] }] };
    mocks.refetchBalance.mockResolvedValue({ data: 0n });
    render(
      <LiquidityPanel pool={makePool()} mode="deposit" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "refresh add" }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Remove Liquidity",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
  });

  it("skips receipt work without a hash, address, receipt, or balance delta", async () => {
    mocks.address = undefined;
    render(
      <LiquidityPanel pool={makePool()} mode="deposit" onClose={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "refresh without hash" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "refresh add" }));
    await waitFor(() => expect(mocks.waitReceipt).not.toHaveBeenCalled());
  });

  it("retries unchanged balances and refetches on a new block", async () => {
    vi.useFakeTimers();
    mocks.balance = 10n;
    mocks.blockNumber = 5n;
    mocks.refetchBalance.mockResolvedValue({ data: 10n });
    render(
      <LiquidityPanel pool={makePool()} mode="deposit" onClose={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "refresh without hash" }),
    );
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.refetchBalance.mock.calls.length).toBeGreaterThanOrEqual(6);
  });
});
