import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TokenSymbol,
  getContractAddress,
  getTokenAddress,
} from "@mento-protocol/mento-sdk";
import { buildApproveTransactionRequest } from "./build-approve-transaction-request";
import { fetchGasEstimation } from "./use-gas-estimation";

const CELO_CHAIN_ID = 42220;
const ACCOUNT = "0x1234567890123456789012345678901234567890";
const APPROVE_SELECTOR = "0x095ea7b3";
const TRANSFER_SELECTOR = "0xa9059cbb";

type PublicClientArg = Parameters<typeof fetchGasEstimation>[1];

function makePublicClient(overrides: {
  estimateGas: ReturnType<typeof vi.fn>;
  getGasPrice?: ReturnType<typeof vi.fn>;
}): PublicClientArg {
  return {
    estimateGas: overrides.estimateGas,
    getGasPrice:
      overrides.getGasPrice ?? vi.fn().mockResolvedValue(1_000_000_000n),
    getBlock: vi.fn(),
  } as unknown as PublicClientArg;
}

const baseParams = {
  amount: "1",
  quote: "1",
  tokenInSymbol: TokenSymbol.USDC,
  tokenOutSymbol: TokenSymbol.USDm,
  address: ACCOUNT,
  chainId: CELO_CHAIN_ID,
  slippage: "0.3",
};

describe("buildApproveTransactionRequest", () => {
  it("targets the tokenIn contract with approve calldata for the Router spender", () => {
    const request = buildApproveTransactionRequest(
      CELO_CHAIN_ID,
      TokenSymbol.USDC,
      "1000000",
    );

    const tokenInAddr = getTokenAddress(CELO_CHAIN_ID, TokenSymbol.USDC);
    const router = getContractAddress(CELO_CHAIN_ID, "Router");

    expect(request.to.toLowerCase()).toBe(tokenInAddr?.toLowerCase());
    expect(request.data.startsWith(APPROVE_SELECTOR)).toBe(true);
    expect(request.data.toLowerCase()).toContain(router.slice(2).toLowerCase());
  });
});

describe("fetchGasEstimation", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("estimates the approve transaction when approval is pending", async () => {
    const estimateGas = vi.fn().mockResolvedValue(50_000n);
    const publicClient = makePublicClient({ estimateGas });

    const result = await fetchGasEstimation(
      { ...baseParams, skipApprove: false },
      publicClient,
    );

    expect(estimateGas).toHaveBeenCalledTimes(1);
    const call = estimateGas.mock.calls[0]?.[0];
    const tokenInAddr = getTokenAddress(CELO_CHAIN_ID, TokenSymbol.USDC);
    expect(String(call.to).toLowerCase()).toBe(tokenInAddr?.toLowerCase());
    expect(String(call.data).startsWith(APPROVE_SELECTOR)).toBe(true);
    expect(String(call.data).startsWith(TRANSFER_SELECTOR)).toBe(false);
    expect(result).not.toBeNull();
  });

  it("returns null (no fabricated fee) when estimation fails", async () => {
    const estimateGas = vi
      .fn()
      .mockRejectedValue(new Error("execution reverted"));
    const publicClient = makePublicClient({ estimateGas });

    const result = await fetchGasEstimation(
      { ...baseParams, skipApprove: false },
      publicClient,
    );

    expect(result).toBeNull();
    // Guard against reintroducing the fabricated fallbacks.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("250000");
    expect(serialized).not.toContain("300000");
    expect(serialized).not.toContain("5000000000");
  });

  it("returns null when required inputs are missing", async () => {
    const estimateGas = vi.fn();
    const publicClient = makePublicClient({ estimateGas });

    const result = await fetchGasEstimation(
      { ...baseParams, amount: "0", skipApprove: false },
      publicClient,
    );

    expect(result).toBeNull();
    expect(estimateGas).not.toHaveBeenCalled();
  });
});
