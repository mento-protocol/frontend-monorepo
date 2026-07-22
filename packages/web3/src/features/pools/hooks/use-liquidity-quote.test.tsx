// @vitest-environment jsdom
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolDisplay } from "../types";

const mocks = vi.hoisted(() => ({
  getMentoSdk: vi.fn(),
  getPublicClient: vi.fn(),
  getBlockNumber: vi.fn(),
  readContract: vi.fn(),
  quoteAddLiquidity: vi.fn(),
  getLPTokenBalance: vi.fn(),
  getPoolDetails: vi.fn(),
}));

vi.mock("@/features/sdk", () => ({
  getMentoSdk: mocks.getMentoSdk,
  getPublicClient: mocks.getPublicClient,
}));

vi.mock("wagmi", () => ({
  useChainId: () => 143,
}));

const { getDesiredBalancedLiquidityAmounts, useLiquidityQuote } =
  await import("./use-liquidity-quote");

const pool: PoolDisplay = {
  poolAddr: "0x0000000000000000000000000000000000000001",
  chainId: 143,
  poolType: "FPMM",
  token0: {
    symbol: "EURm",
    address: "0x0000000000000000000000000000000000000002",
    decimals: 18,
    name: "Euro Mento",
  },
  token1: {
    symbol: "USDm",
    address: "0x0000000000000000000000000000000000000003",
    decimals: 18,
    name: "Dollar Mento",
  },
  reserves: {
    token0: "0",
    token1: "0",
    token0Ratio: 0.5,
    hasLiquidity: true,
  },
  fees: { total: 0.3, lp: 0.2, protocol: 0.1, label: "fee" },
  priceAlignment: { status: "in-band" },
  tvl: 0,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function quoteAtRatio(
  reserve0: bigint,
  reserve1: bigint,
  amount0: bigint,
  amount1: bigint,
) {
  const amount1Optimal = (amount0 * reserve1) / reserve0;
  if (amount1Optimal <= amount1) {
    return { amountA: amount0, amountB: amount1Optimal, liquidity: 1n };
  }

  return {
    amountA: (amount1 * reserve0) / reserve1,
    amountB: amount1,
    liquidity: 1n,
  };
}

describe("useLiquidityQuote", () => {
  let liveReserves: readonly [bigint, bigint, bigint];

  beforeEach(() => {
    vi.clearAllMocks();
    liveReserves = [2_000n, 1_000n, 0n];

    mocks.getBlockNumber.mockResolvedValue(777n);
    mocks.readContract.mockImplementation(async () => liveReserves);
    mocks.getPublicClient.mockReturnValue({
      getBlockNumber: mocks.getBlockNumber,
      readContract: mocks.readContract,
    });
    mocks.getPoolDetails.mockResolvedValue({
      // Deliberately stale 1:1 reserves. Transaction quotes must never read it.
      reserve0: 1_000n,
      reserve1: 1_000n,
    });
    mocks.quoteAddLiquidity.mockImplementation(
      async (_pool, _token0, amount0: bigint, _token1, amount1: bigint) =>
        quoteAtRatio(liveReserves[0], liveReserves[1], amount0, amount1),
    );
    mocks.getLPTokenBalance.mockResolvedValue({ totalSupply: 10_000n });
    mocks.getMentoSdk.mockResolvedValue({
      pools: { getPoolDetails: mocks.getPoolDetails },
      liquidity: {
        quoteAddLiquidity: mocks.quoteAddLiquidity,
        getLPTokenBalance: mocks.getLPTokenBalance,
      },
    });
  });

  afterEach(() => cleanup());

  it("uses a current-block reserve read instead of the primed SDK details cache", async () => {
    const { result } = renderHook(
      () =>
        useLiquidityQuote({
          pool,
          chainId: 143,
          request: {
            id: 1,
            kind: "max",
            token: 0,
            token0Balance: 1_000n,
            token1Balance: 1_000n,
          },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(mocks.getPoolDetails).not.toHaveBeenCalled();
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "getReserves",
        blockNumber: 777n,
      }),
    );
    expect(result.current.data).toMatchObject({
      amountA: 1_000n,
      amountB: 500n,
      reserve0: 2_000n,
      reserve1: 1_000n,
      surplus0: 0n,
      surplus1: 500n,
    });
  });

  it("lets the Router choose token1 as the limiting MAX side", async () => {
    liveReserves = [1_000n, 2_000n, 0n];

    const { result } = renderHook(
      () =>
        useLiquidityQuote({
          pool,
          chainId: 143,
          request: {
            id: 2,
            kind: "max",
            token: 1,
            token0Balance: 1_000n,
            token1Balance: 1_000n,
          },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(result.current.data).toMatchObject({
      amountA: 500n,
      amountB: 1_000n,
      surplus0: 500n,
      surplus1: 0n,
    });
  });

  it("keeps a Router-clipped driver amount canonical", async () => {
    mocks.quoteAddLiquidity.mockResolvedValue({
      amountA: 8n * 10n ** 18n,
      amountB: 4n * 10n ** 18n,
      liquidity: 1n,
    });

    const { result } = renderHook(
      () =>
        useLiquidityQuote({
          pool,
          chainId: 143,
          request: {
            id: 3,
            kind: "max",
            token: 0,
            token0Balance: 10n * 10n ** 18n,
            token1Balance: 10n * 10n ** 18n,
          },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(result.current.data).toMatchObject({
      amountA: 8n * 10n ** 18n,
      amountB: 4n * 10n ** 18n,
    });
  });

  it("does not let an older MAX response replace a newer request", async () => {
    let resolveFirstQuote!: (quote: {
      amountA: bigint;
      amountB: bigint;
      liquidity: bigint;
    }) => void;
    mocks.quoteAddLiquidity
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstQuote = resolve;
          }),
      )
      .mockResolvedValueOnce({ amountA: 900n, amountB: 450n, liquidity: 2n });

    const { result, rerender } = renderHook(
      ({ requestId }) =>
        useLiquidityQuote({
          pool,
          chainId: 143,
          request: {
            id: requestId,
            kind: "max",
            token: 0,
            token0Balance: 1_000n,
            token1Balance: 1_000n,
          },
        }),
      { initialProps: { requestId: 10 }, wrapper },
    );

    await waitFor(() =>
      expect(mocks.quoteAddLiquidity).toHaveBeenCalledTimes(1),
    );
    rerender({ requestId: 11 });

    await waitFor(() =>
      expect(result.current.data).toMatchObject({
        requestId: 11,
        amountA: 900n,
        amountB: 450n,
      }),
    );

    await act(async () => {
      resolveFirstQuote({ amountA: 100n, amountB: 50n, liquidity: 1n });
    });

    expect(result.current.data).toMatchObject({
      requestId: 11,
      amountA: 900n,
      amountB: 450n,
    });
  });
});

describe("getDesiredBalancedLiquidityAmounts", () => {
  it("calculates the fresh reserve-ratio counterpart for either manual driver", () => {
    expect(
      getDesiredBalancedLiquidityAmounts(
        { id: 1, kind: "manual", token: 0, amount: "10" },
        pool,
        20n * 10n ** 18n,
        10n * 10n ** 18n,
      ),
    ).toEqual({
      amount0: 10n * 10n ** 18n,
      amount1: 5n * 10n ** 18n,
    });

    expect(
      getDesiredBalancedLiquidityAmounts(
        { id: 2, kind: "manual", token: 1, amount: "5" },
        pool,
        20n * 10n ** 18n,
        10n * 10n ** 18n,
      ),
    ).toEqual({
      amount0: 10n * 10n ** 18n,
      amount1: 5n * 10n ** 18n,
    });
  });

  it("passes both wallet balances to the live Router for MAX", () => {
    expect(
      getDesiredBalancedLiquidityAmounts(
        {
          id: 3,
          kind: "max",
          token: 0,
          token0Balance: 123n,
          token1Balance: 456n,
        },
        pool,
        999n,
        1n,
      ),
    ).toEqual({ amount0: 123n, amount1: 456n });
  });
});
