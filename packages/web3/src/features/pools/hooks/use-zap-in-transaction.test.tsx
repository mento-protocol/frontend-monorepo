// @vitest-environment jsdom
import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import {
  ROUTER_ABI,
  type PreparedZapIn,
  type ZapInDetails,
  type ZapInTransaction,
} from "@mento-protocol/mento-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, type Address } from "viem";
import type { PoolDisplay } from "../types";

const mocks = vi.hoisted(() => ({
  buildZapInTransaction: vi.fn(),
  estimateGas: vi.fn(),
  getBlock: vi.fn(),
  prepareZapIn: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("@/features/sdk", () => ({
  getMentoSdk: vi.fn().mockResolvedValue({
    liquidity: {
      buildZapInTransaction: mocks.buildZapInTransaction,
      prepareZapIn: mocks.prepareZapIn,
    },
  }),
}));

vi.mock("wagmi", () => ({
  useChainId: () => 143,
  usePublicClient: () => ({
    estimateGas: mocks.estimateGas,
    getBlock: mocks.getBlock,
    readContract: mocks.readContract,
    waitForTransactionReceipt: mocks.waitForTransactionReceipt,
  }),
  useSendTransaction: () => ({
    isPending: false,
    reset: vi.fn(),
    sendTransactionAsync: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@mento-protocol/ui", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("../liquidity-toast", () => ({
  showLiquiditySuccessToast: vi.fn(),
}));

const { useZapInTransaction } = await import("./use-zap-in-transaction");

const POOL_ADDRESS = "0x0000000000000000000000000000000000000001";
const TOKEN_0 = "0x0000000000000000000000000000000000000002";
const TOKEN_1 = "0x0000000000000000000000000000000000000003";
const RECIPIENT = "0x0000000000000000000000000000000000000004";
const ROUTER = "0x0000000000000000000000000000000000000005";
const FACTORY = "0x0000000000000000000000000000000000000006";
const AMOUNT_IN = 1_000_000n;
const PROBE_AMOUNT = AMOUNT_IN / 2n;
const BLOCK_NUMBER = 777n;

type SelectedToken = "token0" | "token1";

const pool: PoolDisplay = {
  poolAddr: POOL_ADDRESS,
  chainId: 143,
  poolType: "FPMM",
  token0: { symbol: "EURm", address: TOKEN_0, decimals: 18, name: "EURm" },
  token1: { symbol: "USDm", address: TOKEN_1, decimals: 18, name: "USDm" },
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

let liveReserve0 = 10_000_000n;
let liveReserve1 = 20_000_000n;
let liveProtocolFee = 0n;
let routeValidationAmountOut = 100n;

function makeDetails({
  selectedToken,
  amountInA,
  amountInB,
}: {
  selectedToken: SelectedToken;
  amountInA: bigint;
  amountInB: bigint;
}): ZapInDetails {
  const selectedIsToken0 = selectedToken === "token0";
  return {
    params: { to: ROUTER, data: "0xdeadbeef", value: "0" },
    poolAddress: POOL_ADDRESS,
    tokenIn: selectedIsToken0 ? TOKEN_0 : TOKEN_1,
    amountIn: amountInA + amountInB,
    amountInA,
    amountInB,
    routesA: selectedIsToken0
      ? []
      : [{ from: TOKEN_1, to: TOKEN_0, factory: FACTORY }],
    routesB: selectedIsToken0
      ? [{ from: TOKEN_0, to: TOKEN_1, factory: FACTORY }]
      : [],
    zapParams: {
      tokenA: TOKEN_0,
      tokenB: TOKEN_1,
      factory: FACTORY,
      amountOutMinA: 101n,
      amountOutMinB: 202n,
      amountAMin: 11n,
      amountBMin: 22n,
    },
    estimatedMinLiquidity: 303n,
  };
}

function makePrepared(selectedToken: SelectedToken): PreparedZapIn {
  const details = makeDetails({
    selectedToken,
    amountInA: PROBE_AMOUNT,
    amountInB: PROBE_AMOUNT,
  });
  return {
    routesA: details.routesA,
    routesB: details.routesB,
    quote: {
      amountOutFromA: selectedToken === "token1" ? PROBE_AMOUNT : 0n,
      amountOutFromB: selectedToken === "token0" ? PROBE_AMOUNT : 0n,
      amountAMin: details.zapParams.amountAMin,
      amountBMin: details.zapParams.amountBMin,
      estimatedMinLiquidity: details.estimatedMinLiquidity,
    },
    details,
  };
}

function makeBuild({
  approval,
  selectedToken,
  splitBps,
}: {
  approval: boolean;
  selectedToken: SelectedToken;
  splitBps: number;
}): ZapInTransaction {
  const amountInA = (AMOUNT_IN * BigInt(splitBps)) / 10_000n;
  const amountInB = AMOUNT_IN - amountInA;
  const tokenIn = selectedToken === "token0" ? TOKEN_0 : TOKEN_1;

  return {
    approval: approval
      ? {
          token: tokenIn,
          amount: AMOUNT_IN,
          params: { to: tokenIn, data: "0xaaaa", value: "0" },
        }
      : null,
    zapIn: makeDetails({ selectedToken, amountInA, amountInB }),
  };
}

function configureBindingBuild(
  selectedToken: SelectedToken,
  approval: boolean,
  expectedSplitBps = selectedToken === "token0" ? 3_548 : 6_452,
): { rawBuild: ZapInTransaction; splitBps: number } {
  const splitBps = expectedSplitBps;
  const rawBuild = makeBuild({ approval, selectedToken, splitBps });
  mocks.prepareZapIn.mockResolvedValue(makePrepared(selectedToken));
  mocks.buildZapInTransaction.mockResolvedValue(rawBuild);
  return { rawBuild, splitBps };
}

async function buildTransaction(
  hook: RenderHookResult<ReturnType<typeof useZapInTransaction>, unknown>,
  tokenIn: Address,
): Promise<ZapInTransaction | null> {
  let build: ZapInTransaction | null = null;
  await act(async () => {
    build = await hook.result.current.buildTransaction(
      tokenIn,
      AMOUNT_IN,
      RECIPIENT as Address,
      0.5,
    );
  });
  return build as ZapInTransaction | null;
}

function getReadFunctionNames(): string[] {
  return mocks.readContract.mock.calls.map(
    ([request]) => (request as { functionName: string }).functionName,
  );
}

function decodeBoundZapIn(build: ZapInTransaction) {
  const decoded = decodeFunctionData({
    abi: ROUTER_ABI,
    data: build.zapIn.params.data as `0x${string}`,
  });
  if (decoded.functionName !== "zapIn") {
    throw new Error("Expected zapIn calldata");
  }
  return decoded;
}

describe("useZapInTransaction binding build", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildZapInTransaction.mockReset();
    mocks.estimateGas.mockReset().mockResolvedValue(250_000n);
    mocks.getBlock
      .mockReset()
      .mockResolvedValue({ timestamp: 1_000n, number: BLOCK_NUMBER });
    mocks.prepareZapIn.mockReset();
    mocks.readContract.mockReset();
    mocks.waitForTransactionReceipt.mockReset();

    liveReserve0 = 10_000_000n;
    liveReserve1 = 20_000_000n;
    liveProtocolFee = 0n;
    routeValidationAmountOut = 100n;
    mocks.readContract.mockImplementation(
      async (request: { args?: readonly unknown[]; functionName: string }) => {
        switch (request.functionName) {
          case "getReserves":
            return [liveReserve0, liveReserve1, 0n] as const;
          case "protocolFee":
            return liveProtocolFee;
          case "getAmountsOut": {
            const amountIn = request.args?.[0] as bigint;
            return [amountIn, routeValidationAmountOut];
          }
          case "getPool":
            return POOL_ADDRESS;
          case "token0":
            return TOKEN_0;
          default:
            throw new Error(`Unexpected read: ${request.functionName}`);
        }
      },
    );
  });

  it.each([
    {
      selectedToken: "token0" as const,
      tokenIn: TOKEN_0,
      reserve0: 10_000_000n,
      reserve1: 20_000_000n,
      expectedSplitBps: 3_547,
      expectedAmountAMin: 354_700n,
      expectedAmountBMin: 22n,
    },
    {
      selectedToken: "token1" as const,
      tokenIn: TOKEN_1,
      reserve0: 20_000_000n,
      reserve1: 10_000_000n,
      expectedSplitBps: 6_453,
      expectedAmountAMin: 11n,
      expectedAmountBMin: 354_700n,
    },
  ])(
    "uses live state and encodes a strict $selectedToken minimum",
    async ({
      selectedToken,
      tokenIn,
      reserve0,
      reserve1,
      expectedSplitBps,
      expectedAmountAMin,
      expectedAmountBMin,
    }) => {
      liveReserve0 = reserve0;
      liveReserve1 = reserve1;
      liveProtocolFee = 50n;
      const { rawBuild } = configureBindingBuild(
        selectedToken,
        false,
        expectedSplitBps,
      );
      const hook = renderHook(() => useZapInTransaction(pool, 143));

      const build = await buildTransaction(hook, tokenIn as Address);

      expect(build).not.toBeNull();
      expect(build).not.toBe(rawBuild);
      expect(mocks.prepareZapIn).toHaveBeenCalledWith(
        expect.objectContaining({
          amountIn: AMOUNT_IN,
          amountInSplit: expect.any(Number),
          options: { slippageTolerance: 0, deadline: 2_200n },
          poolAddress: POOL_ADDRESS,
          recipient: RECIPIENT,
          tokenIn,
        }),
      );
      const probeInput = mocks.prepareZapIn.mock.calls[0]?.[0] as {
        amountInSplit: number;
      };
      expect(Math.floor(probeInput.amountInSplit * 10_000)).toBe(5_000);

      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: POOL_ADDRESS,
          blockNumber: BLOCK_NUMBER,
          functionName: "getReserves",
        }),
      );
      expect(mocks.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: POOL_ADDRESS,
          blockNumber: BLOCK_NUMBER,
          functionName: "protocolFee",
        }),
      );

      const finalInput = mocks.buildZapInTransaction.mock.calls[0]?.[0] as {
        amountIn: bigint;
        amountInSplit: number;
        options: { deadline: bigint; slippageTolerance: number };
        owner: string;
      };
      expect(finalInput.amountIn).toBe(AMOUNT_IN);
      expect(Math.floor(finalInput.amountInSplit * 10_000)).toBe(
        expectedSplitBps,
      );
      expect(finalInput.owner).toBe(RECIPIENT);
      expect(finalInput.options).toEqual({
        slippageTolerance: 0.5,
        deadline: 2_200n,
      });

      const bound = build as ZapInTransaction;
      const decoded = decodeBoundZapIn(bound);
      const encodedZapParams = decoded.args[3];
      expect(decoded.args[1] + decoded.args[2]).toBe(AMOUNT_IN);
      expect(decoded.args[6]).toBe(RECIPIENT);
      expect(encodedZapParams.amountAMin).toBe(expectedAmountAMin);
      expect(encodedZapParams.amountBMin).toBe(expectedAmountBMin);
      expect(bound.zapIn.zapParams.amountAMin).toBe(expectedAmountAMin);
      expect(bound.zapIn.zapParams.amountBMin).toBe(expectedAmountBMin);
      expect(mocks.estimateGas).toHaveBeenCalledWith(
        expect.objectContaining({ data: bound.zapIn.params.data }),
      );
      expect(hook.result.current.buildResult).toBe(bound);
      expect(hook.result.current.buildError).toBeNull();
    },
  );

  it.each([
    "execution reverted: Transfer failed",
    "ERC20: transfer amount exceeds allowance",
  ])(
    "preserves a strict build after an approval preflight failure: %s",
    async (error) => {
      configureBindingBuild("token1", true);
      liveReserve0 = 20_000_000n;
      liveReserve1 = 10_000_000n;
      mocks.estimateGas.mockRejectedValueOnce(new Error(error));
      const hook = renderHook(() => useZapInTransaction(pool, 143));

      const build = await buildTransaction(hook, TOKEN_1 as Address);

      expect(build).not.toBeNull();
      expect(build?.approval?.amount).toBe(AMOUNT_IN);
      expect(
        decodeBoundZapIn(build as ZapInTransaction).args[3].amountBMin,
      ).toBe(354_800n);
      expect(getReadFunctionNames()).toEqual(
        expect.arrayContaining([
          "getReserves",
          "protocolFee",
          "getAmountsOut",
          "getPool",
          "token0",
        ]),
      );
      expect(mocks.estimateGas).toHaveBeenCalledTimes(1);
      expect(hook.result.current.buildResult).toBe(build);
      expect(hook.result.current.buildError).toBeNull();
    },
  );

  it("rebuilds the probe, live state, and final transaction after approval", async () => {
    liveReserve0 = 20_000_000n;
    liveReserve1 = 10_000_000n;
    mocks.getBlock
      .mockReset()
      .mockResolvedValueOnce({ timestamp: 1_000n, number: 777n })
      .mockResolvedValueOnce({ timestamp: 1_001n, number: 778n });
    mocks.prepareZapIn.mockResolvedValue(makePrepared("token1"));
    const approvalBuild = makeBuild({
      approval: true,
      selectedToken: "token1",
      splitBps: 6_452,
    });
    const freshBuild = makeBuild({
      approval: false,
      selectedToken: "token1",
      splitBps: 6_452,
    });
    mocks.buildZapInTransaction
      .mockResolvedValueOnce(approvalBuild)
      .mockResolvedValueOnce(freshBuild);
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    const first = await buildTransaction(hook, TOKEN_1 as Address);
    const second = await buildTransaction(hook, TOKEN_1 as Address);

    expect(first?.approval).not.toBeNull();
    expect(second?.approval).toBeNull();
    expect(mocks.getBlock).toHaveBeenCalledTimes(2);
    expect(mocks.prepareZapIn).toHaveBeenCalledTimes(2);
    expect(mocks.buildZapInTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.estimateGas).toHaveBeenCalledTimes(2);
    const stateReads = mocks.readContract.mock.calls
      .map(
        ([request]) =>
          request as { blockNumber?: bigint; functionName: string },
      )
      .filter(({ functionName }) =>
        ["getReserves", "protocolFee"].includes(functionName),
      );
    expect(stateReads.map(({ blockNumber }) => blockNumber)).toEqual([
      777n,
      777n,
      778n,
      778n,
    ]);
    expect(hook.result.current.buildResult).toBe(second);
  });

  it("blocks a generic estimate failure when no approval is required", async () => {
    configureBindingBuild("token1", false);
    liveReserve0 = 20_000_000n;
    liveReserve1 = 10_000_000n;
    mocks.estimateGas.mockRejectedValueOnce(
      new Error("execution reverted: Transfer failed"),
    );
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook, TOKEN_1 as Address)).toBeNull();
    expect(getReadFunctionNames()).not.toContain("getAmountsOut");
    expect(hook.result.current.buildResult).toBeNull();
    expect(hook.result.current.buildError).toBe(
      "This single-token amount cannot be simulated right now. Try a smaller amount, higher slippage, or balanced mode.",
    );
  });

  it("blocks a known liquidity failure before approval route validation", async () => {
    configureBindingBuild("token1", true);
    liveReserve0 = 20_000_000n;
    liveReserve1 = 10_000_000n;
    mocks.estimateGas.mockRejectedValueOnce(
      new Error("execution reverted: insufficient liquidity"),
    );
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook, TOKEN_1 as Address)).toBeNull();
    expect(getReadFunctionNames()).not.toContain("getAmountsOut");
    expect(hook.result.current.buildError).toBe(
      "Pool liquidity is insufficient for this single-token amount.",
    );
  });

  it("blocks an approval waiver when the live route output exhausts a reserve", async () => {
    configureBindingBuild("token1", true);
    liveReserve0 = 20_000_000n;
    liveReserve1 = 10_000_000n;
    routeValidationAmountOut = liveReserve0;
    mocks.estimateGas.mockRejectedValueOnce(
      new Error("execution reverted: Transfer failed"),
    );
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook, TOKEN_1 as Address)).toBeNull();
    expect(getReadFunctionNames()).toContain("getAmountsOut");
    expect(hook.result.current.buildError).toBe(
      "Pool liquidity is insufficient for this single-token amount.",
    );
  });

  it("fails closed when the final SDK build changes the calculated split", async () => {
    liveReserve0 = 20_000_000n;
    liveReserve1 = 10_000_000n;
    mocks.prepareZapIn.mockResolvedValue(makePrepared("token1"));
    mocks.buildZapInTransaction.mockResolvedValue(
      makeBuild({
        approval: false,
        selectedToken: "token1",
        splitBps: 6_451,
      }),
    );
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook, TOKEN_1 as Address)).toBeNull();
    expect(mocks.estimateGas).not.toHaveBeenCalled();
    expect(hook.result.current.buildError).toBe(
      "Unable to prepare single-token liquidity right now.",
    );
  });

  it("fails before quoting when the latest block has no number", async () => {
    mocks.getBlock.mockResolvedValueOnce({ timestamp: 1_000n, number: null });
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook, TOKEN_1 as Address)).toBeNull();
    expect(mocks.prepareZapIn).not.toHaveBeenCalled();
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(hook.result.current.buildError).toBe(
      "Unable to prepare single-token liquidity right now.",
    );
  });
});
