// @vitest-environment jsdom
import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import type { ZapInTransaction } from "@mento-protocol/mento-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import type { PoolDisplay } from "../types";

const mocks = vi.hoisted(() => ({
  buildZapInTransaction: vi.fn(),
  estimateGas: vi.fn(),
  getBlock: vi.fn(),
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("@/features/sdk", () => ({
  getMentoSdk: vi.fn().mockResolvedValue({
    liquidity: { buildZapInTransaction: mocks.buildZapInTransaction },
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

vi.mock("@mento-protocol/mento-sdk", () => ({
  FPMM_ABI: [],
  ROUTER_ABI: [],
}));

vi.mock("@/utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("../liquidity-toast", () => ({
  showLiquiditySuccessToast: vi.fn(),
}));

const { useZapInTransaction } = await import("./use-zap-in-transaction");

const POOL_ADDRESS = "0x0000000000000000000000000000000000000001";
const TOKEN_IN = "0x0000000000000000000000000000000000000002";
const RECIPIENT = "0x0000000000000000000000000000000000000003";
const ROUTER = "0x0000000000000000000000000000000000000004";

const pool: PoolDisplay = {
  poolAddr: POOL_ADDRESS,
  chainId: 143,
  poolType: "FPMM",
  token0: { symbol: "EURm", address: TOKEN_IN, decimals: 18, name: "EURm" },
  token1: {
    symbol: "USDm",
    address: "0x0000000000000000000000000000000000000005",
    decimals: 18,
    name: "USDm",
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

function makeBuild({ approval }: { approval: boolean }): ZapInTransaction {
  return {
    approval: approval
      ? {
          params: { to: TOKEN_IN, data: "0xapproval", value: "0" },
        }
      : undefined,
    zapIn: {
      params: { to: ROUTER, data: "0xzap", value: "0" },
      routesA: [],
      routesB: [],
      amountInA: 1n,
      amountInB: 0n,
    },
  } as unknown as ZapInTransaction;
}

async function buildTransaction(
  hook: RenderHookResult<ReturnType<typeof useZapInTransaction>, unknown>,
) {
  let build: ZapInTransaction | null = null;
  await act(async () => {
    build = await hook.result.current.buildTransaction(
      TOKEN_IN as Address,
      1n,
      RECIPIENT as Address,
      0.5,
    );
  });
  return build;
}

describe("useZapInTransaction build preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildZapInTransaction.mockReset();
    mocks.estimateGas.mockReset();
    mocks.getBlock.mockReset();
    mocks.readContract.mockReset();
    mocks.waitForTransactionReceipt.mockReset();
    mocks.getBlock.mockResolvedValue({ timestamp: 1_000n });
  });

  it("preserves a build requiring approval without running the zap estimate", async () => {
    const approvalBuild = makeBuild({ approval: true });
    mocks.buildZapInTransaction.mockResolvedValueOnce(approvalBuild);
    mocks.estimateGas.mockRejectedValueOnce(
      new Error("execution reverted: Transfer failed"),
    );
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    const build = await buildTransaction(hook);

    expect(build).toBe(approvalBuild);
    expect(hook.result.current.buildResult).toBe(approvalBuild);
    expect(hook.result.current.buildError).toBeNull();
    expect(mocks.estimateGas).toHaveBeenCalledTimes(1);
  });

  it("runs the fail-closed estimate on a fresh build after approval", async () => {
    const approvalBuild = makeBuild({ approval: true });
    const freshBuild = makeBuild({ approval: false });
    mocks.buildZapInTransaction
      .mockResolvedValueOnce(approvalBuild)
      .mockResolvedValueOnce(freshBuild);
    mocks.estimateGas.mockResolvedValueOnce(250_000n);
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook)).toBe(approvalBuild);
    expect(mocks.estimateGas).toHaveBeenCalledTimes(1);

    expect(await buildTransaction(hook)).toBe(freshBuild);
    expect(mocks.estimateGas).toHaveBeenCalledTimes(2);
    expect(hook.result.current.buildResult).toBe(freshBuild);
    expect(hook.result.current.buildError).toBeNull();
  });

  it("blocks a generic transfer failure when no approval is required", async () => {
    const buildWithoutApproval = makeBuild({ approval: false });
    mocks.buildZapInTransaction.mockResolvedValueOnce(buildWithoutApproval);
    mocks.estimateGas.mockRejectedValueOnce(
      new Error("execution reverted: Transfer failed"),
    );
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook)).toBeNull();
    expect(mocks.estimateGas).toHaveBeenCalledTimes(1);
    expect(hook.result.current.buildResult).toBeNull();
    expect(hook.result.current.buildError).toBe(
      "This single-token amount cannot be simulated right now. Try a smaller amount, higher slippage, or balanced mode.",
    );
  });

  it("blocks a known liquidity failure even when approval is required", async () => {
    const approvalBuild = makeBuild({ approval: true });
    mocks.buildZapInTransaction.mockResolvedValueOnce(approvalBuild);
    mocks.estimateGas.mockRejectedValueOnce(
      new Error("execution reverted: insufficient liquidity"),
    );
    const hook = renderHook(() => useZapInTransaction(pool, 143));

    expect(await buildTransaction(hook)).toBeNull();
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(hook.result.current.buildError).toBe(
      "Pool liquidity is insufficient for this single-token amount.",
    );
  });
});
