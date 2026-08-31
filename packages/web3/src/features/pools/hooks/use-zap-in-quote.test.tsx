// @vitest-environment jsdom
import React from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PreparedZapIn } from "@mento-protocol/mento-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { PoolDisplay, SlippageOption } from "../types";

const mocks = vi.hoisted(() => ({
  getBlock: vi.fn(),
  getLPTokenBalance: vi.fn(),
  getMentoSdk: vi.fn(),
  getPublicClient: vi.fn(),
  prepareZapIn: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("@/features/sdk", () => ({
  getMentoSdk: mocks.getMentoSdk,
  getPublicClient: mocks.getPublicClient,
}));

vi.mock("@/utils/debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

vi.mock("wagmi", () => ({
  useChainId: () => 143,
}));

const { useZapInQuote } = await import("./use-zap-in-quote");

const POOL: Address = "0x0000000000000000000000000000000000000001";
const TOKEN_0: Address = "0x0000000000000000000000000000000000000002";
const TOKEN_1: Address = "0x0000000000000000000000000000000000000003";
const FACTORY: Address = "0x0000000000000000000000000000000000000004";
const ROUTER: Address = "0x0000000000000000000000000000000000000005";

const pool: PoolDisplay = {
  poolAddr: POOL,
  chainId: 143,
  poolType: "FPMM",
  token0: {
    symbol: "EURm",
    address: TOKEN_0,
    decimals: 6,
    name: "Euro Mento",
  },
  token1: {
    symbol: "USDm",
    address: TOKEN_1,
    decimals: 6,
    name: "Dollar Mento",
  },
  reserves: {
    token0: "1",
    token1: "1",
    token0Ratio: 0.5,
    hasLiquidity: true,
  },
  fees: { total: 0.3, lp: 0.25, protocol: 0.05, label: "fee" },
  priceAlignment: { status: "in-band" },
  tvl: 2,
};

type SelectedToken = "token0" | "token1";

function makePrepared({
  selectedToken,
  amountInA,
  amountInB,
  quote,
}: {
  selectedToken: SelectedToken;
  amountInA: bigint;
  amountInB: bigint;
  quote: PreparedZapIn["quote"];
}): PreparedZapIn {
  const selectedIsToken0 = selectedToken === "token0";
  const routesA = selectedIsToken0
    ? []
    : [{ from: TOKEN_1, to: TOKEN_0, factory: FACTORY }];
  const routesB = selectedIsToken0
    ? [{ from: TOKEN_0, to: TOKEN_1, factory: FACTORY }]
    : [];

  return {
    routesA,
    routesB,
    quote,
    details: {
      params: { to: ROUTER, data: "0x", value: "0" },
      poolAddress: POOL,
      tokenIn: selectedIsToken0 ? TOKEN_0 : TOKEN_1,
      amountIn: amountInA + amountInB,
      amountInA,
      amountInB,
      routesA,
      routesB,
      zapParams: {
        tokenA: TOKEN_0,
        tokenB: TOKEN_1,
        factory: FACTORY,
        amountOutMinA: quote.amountOutFromA,
        amountOutMinB: quote.amountOutFromB,
        amountAMin: quote.amountAMin,
        amountBMin: quote.amountBMin,
      },
      estimatedMinLiquidity: quote.estimatedMinLiquidity,
    },
  };
}

const finalQuote = {
  estimatedMinLiquidity: 321_000n,
  amountOutFromA: 123_000n,
  amountOutFromB: 456_000n,
  amountAMin: 111_000n,
  amountBMin: 222_000n,
};

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useZapInQuote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.getBlock.mockResolvedValue({ number: 777n, timestamp: 1_000n });
    mocks.readContract.mockImplementation(
      async ({
        args,
        functionName,
      }: {
        args?: readonly unknown[];
        functionName: string;
      }) => {
        if (functionName === "getReserves") return [20_000_000n, 10_000_000n];
        if (functionName === "protocolFee") return 50n;
        if (functionName === "getAmountsOut") return [args?.[0], 500_000n];
        throw new Error(`Unexpected contract read: ${functionName}`);
      },
    );
    mocks.getPublicClient.mockReturnValue({
      getBlock: mocks.getBlock,
      readContract: mocks.readContract,
    });
    mocks.getLPTokenBalance.mockResolvedValue({ totalSupply: 9_999_999n });
    mocks.getMentoSdk.mockResolvedValue({
      liquidity: {
        prepareZapIn: mocks.prepareZapIn,
        getLPTokenBalance: mocks.getLPTokenBalance,
      },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it.each([
    {
      selectedToken: "token0" as const,
      tokenIn: TOKEN_0,
      reserves: [10_000_000n, 20_000_000n] as const,
      expectedSplitBps: 3_547,
      finalAmountInA: 354_700n,
      finalAmountInB: 645_300n,
      slippage: 0.5 as SlippageOption,
    },
    {
      selectedToken: "token1" as const,
      tokenIn: TOKEN_1,
      reserves: [20_000_000n, 10_000_000n] as const,
      expectedSplitBps: 6_453,
      finalAmountInA: 645_300n,
      finalAmountInB: 354_700n,
      slippage: 1 as SlippageOption,
    },
  ])(
    "prepares a binding $selectedToken split from one pinned block",
    async ({
      selectedToken,
      tokenIn,
      reserves,
      expectedSplitBps,
      finalAmountInA,
      finalAmountInB,
      slippage,
    }) => {
      mocks.readContract.mockImplementation(
        async ({
          args,
          functionName,
        }: {
          args?: readonly unknown[];
          functionName: string;
        }) => {
          if (functionName === "getReserves") return reserves;
          if (functionName === "protocolFee") return 50n;
          if (functionName === "getAmountsOut") return [args?.[0], 500_000n];
          throw new Error(`Unexpected contract read: ${functionName}`);
        },
      );
      const probeQuote = {
        estimatedMinLiquidity: 1n,
        // The shared planner must ignore this unpinned SDK output.
        amountOutFromA: selectedToken === "token1" ? 400_000n : 0n,
        amountOutFromB: selectedToken === "token0" ? 400_000n : 0n,
        amountAMin: 1n,
        amountBMin: 1n,
      };
      mocks.prepareZapIn
        .mockResolvedValueOnce(
          makePrepared({
            selectedToken,
            amountInA: 500_000n,
            amountInB: 500_000n,
            quote: probeQuote,
          }),
        )
        .mockResolvedValueOnce(
          makePrepared({
            selectedToken,
            amountInA: finalAmountInA,
            amountInB: finalAmountInB,
            quote: finalQuote,
          }),
        );

      const { result } = renderHook(
        () =>
          useZapInQuote({
            pool,
            tokenIn,
            amountIn: "1",
            slippage,
            chainId: 143,
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mocks.getMentoSdk).toHaveBeenCalledWith(143);
      expect(mocks.getPublicClient).toHaveBeenCalledWith(143);
      expect(mocks.getBlock).toHaveBeenCalledTimes(1);
      expect(mocks.readContract).toHaveBeenCalledTimes(3);
      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: POOL,
          functionName: "getReserves",
          blockNumber: 777n,
        }),
      );
      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: ROUTER,
          args: [500_000n, expect.any(Array)],
          functionName: "getAmountsOut",
          blockNumber: 777n,
        }),
      );
      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: POOL,
          functionName: "protocolFee",
          blockNumber: 777n,
        }),
      );

      expect(mocks.prepareZapIn).toHaveBeenCalledTimes(2);
      const probeInput = mocks.prepareZapIn.mock.calls[0]?.[0];
      const finalInput = mocks.prepareZapIn.mock.calls[1]?.[0];
      if (!probeInput || !finalInput) {
        throw new Error("Expected both zap-in preparation calls");
      }
      expect(probeInput).toMatchObject({
        poolAddress: POOL,
        tokenIn,
        amountIn: 1_000_000n,
        recipient: tokenIn,
        options: { slippageTolerance: 0, deadline: 2_200n },
      });
      expect(Math.floor(probeInput.amountInSplit * 10_000)).toBe(5_000);
      expect(finalInput).toMatchObject({
        poolAddress: POOL,
        tokenIn,
        amountIn: 1_000_000n,
        recipient: tokenIn,
        options: { slippageTolerance: slippage, deadline: 2_200n },
      });
      expect(Math.floor(finalInput.amountInSplit * 10_000)).toBe(
        expectedSplitBps,
      );
      expect(result.current.data).toEqual({
        ...finalQuote,
        totalSupply: 9_999_999n,
      });
    },
  );
});
