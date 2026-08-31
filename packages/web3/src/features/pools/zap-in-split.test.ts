import {
  ROUTER_ABI,
  type PreparedZapIn,
  type ZapInTransaction,
} from "@mento-protocol/mento-sdk";
import { decodeFunctionData, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  bindSelectedTokenMinimum,
  assertBindingZapInPlan,
  deriveBindingZapInPlan,
  findBindingZapInSplit,
  projectZapInSplit,
  quoteZapInDeposit,
  splitZapInAmount,
  toSdkZapInSplitRatio,
  toZapInProtocolFeeBps,
  type ZapInSelectedToken,
} from "./zap-in-split";

const TOKEN_0 = "0x0000000000000000000000000000000000000001";
const TOKEN_1 = "0x0000000000000000000000000000000000000002";
const FACTORY = "0x0000000000000000000000000000000000000003";
const ROUTER = "0x0000000000000000000000000000000000000004";
const RECIPIENT = "0x0000000000000000000000000000000000000005";

function makeTransaction({
  selectedToken,
  amountInA,
  amountInB,
}: {
  selectedToken: ZapInSelectedToken;
  amountInA: bigint;
  amountInB: bigint;
}): ZapInTransaction {
  const selectedIsToken0 = selectedToken === "token0";
  return {
    approval: null,
    zapIn: {
      params: { to: ROUTER, data: "0xdeadbeef", value: "0" },
      poolAddress: "0x0000000000000000000000000000000000000006",
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
    },
  };
}

function makePreparedProbe(selectedToken: ZapInSelectedToken): PreparedZapIn {
  const transaction = makeTransaction({
    selectedToken,
    amountInA: 500_000n,
    amountInB: 500_000n,
  });
  const quote = {
    amountOutFromA: 500_000n,
    amountOutFromB: 500_000n,
    amountAMin: 1n,
    amountBMin: 1n,
    estimatedMinLiquidity: 1n,
  };

  return {
    routesA: transaction.zapIn.routesA,
    routesB: transaction.zapIn.routesB,
    quote,
    details: transaction.zapIn,
  };
}

describe("findBindingZapInSplit", () => {
  it.each([
    {
      selectedToken: "token0" as const,
      reserve0: 10_000_000n,
      reserve1: 20_000_000n,
      expectedSplitBps: 3_548,
      lessSwapSplitBps: 3_549,
    },
    {
      selectedToken: "token1" as const,
      reserve0: 20_000_000n,
      reserve1: 10_000_000n,
      expectedSplitBps: 6_452,
      lessSwapSplitBps: 6_451,
    },
  ])(
    "rounds toward more swap when $selectedToken is selected",
    ({
      selectedToken,
      reserve0,
      reserve1,
      expectedSplitBps,
      lessSwapSplitBps,
    }) => {
      const amountIn = 1_000_000n;
      const input = {
        amountIn,
        selectedToken,
        reserve0,
        reserve1,
        swapMovesTargetReserves: true,
        protocolFeeBps: 0,
      };

      const projection = findBindingZapInSplit({
        ...input,
        getAmountOut: (swapAmount) => swapAmount,
      });
      const lessSwap = splitZapInAmount(amountIn, lessSwapSplitBps);
      const lessSwapAmount =
        selectedToken === "token0" ? lessSwap.amountInB : lessSwap.amountInA;
      const lessSwapProjection = projectZapInSplit({
        ...input,
        splitBps: lessSwapSplitBps,
        amountOut: lessSwapAmount,
      });

      expect(projection.splitBps).toBe(expectedSplitBps);
      expect(projection.amountInA + projection.amountInB).toBe(amountIn);
      expect(projection.selectedTokenRefund).toBe(0n);
      expect(projection.generatedTokenRefund).toBe(113n);
      expect(lessSwapProjection.selectedTokenRefund).toBe(99n);
    },
  );

  it("binds the full recorded Monad USDm amount instead of refunding 21.995825874957169873 USDm", () => {
    const amountIn = 132_816_340_037_720_042_086n;
    const recordedHalfDeposit = 44_412_344_143_902_851_170n;
    const halfSwap = amountIn / 2n;

    // These normalized reserves preserve the pool ratio recorded during the
    // investigation. The one-to-one quote isolates the split and reserve math.
    const reserve0 = 2_800n * amountIn;
    const reserve1 =
      (recordedHalfDeposit * (reserve0 - halfSwap)) / halfSwap - halfSwap;
    const input = {
      amountIn,
      selectedToken: "token1" as const,
      reserve0,
      reserve1,
      swapMovesTargetReserves: true,
      protocolFeeBps: 0,
    };

    const oldHalfSplit = projectZapInSplit({
      ...input,
      splitBps: 5_000,
      amountOut: halfSwap,
    });
    const projection = findBindingZapInSplit({
      ...input,
      getAmountOut: (swapAmount) => swapAmount,
    });

    expect(oldHalfSplit.depositedAmount1).toBe(recordedHalfDeposit);
    expect(oldHalfSplit.selectedTokenRefund).toBe(21_995_825_874_957_169_873n);
    expect(projection.splitBps).toBe(5_993);
    expect(projection.amountInA + projection.amountInB).toBe(amountIn);
    expect(projection.selectedTokenRefund).toBe(0n);
    expect(projection.generatedTokenRefund).toBeGreaterThan(0n);
  });

  it("uses the full USDm amount against the affected pool at Monad block 100734438", () => {
    const amountIn = 132_816_340_037_720_042_086n;
    const probeSwapAmount = amountIn / 2n;
    const probeAmountOut = 57_168_956_662_239_501_850n;
    const projection = findBindingZapInSplit({
      amountIn,
      selectedToken: "token1",
      reserve0: 347_079_963_968_668_008_569_634n,
      reserve1: 269_487_265_753_852_835_370_164n,
      swapMovesTargetReserves: true,
      protocolFeeBps: 5,
      getAmountOut: (swapAmount) =>
        (swapAmount * probeAmountOut) / probeSwapAmount,
    });

    expect(projection.splitBps).toBe(5_993);
    expect(projection.amountInA).toBe(79_596_832_584_605_621_222n);
    expect(projection.amountInB).toBe(53_219_507_453_114_420_864n);
    expect(projection.amountInA + projection.amountInB).toBe(amountIn);
    expect(projection.selectedTokenRefund).toBe(0n);
    expect(projection.generatedTokenRefund).toBe(13_620_487_490_367_056n);
  });

  it("rejects an invalid snapshot before it requests a route quote", () => {
    let quoteCalls = 0;

    expect(() =>
      findBindingZapInSplit({
        amountIn: 1_000_000n,
        selectedToken: "token0",
        reserve0: 0n,
        reserve1: 20_000_000n,
        swapMovesTargetReserves: true,
        protocolFeeBps: 50,
        getAmountOut: () => {
          quoteCalls += 1;
          return 1n;
        },
      }),
    ).toThrow("reserve0 must be greater than zero");
    expect(quoteCalls).toBe(0);
  });
});

describe("split precision and reserve projection", () => {
  it("preserves a one-basis-point SDK split that direct division rounds down", () => {
    const splitBps = 3;

    expect(Math.floor((splitBps / 10_000) * 10_000)).toBe(splitBps - 1);
    expect(Math.floor(toSdkZapInSplitRatio(splitBps) * 10_000)).toBe(splitBps);
  });

  it("maps every basis-point value to the exact integer used by the SDK", () => {
    for (let splitBps = 0; splitBps <= 10_000; splitBps += 1) {
      expect(Math.floor(toSdkZapInSplitRatio(splitBps) * 10_000)).toBe(
        splitBps,
      );
    }
  });

  it("accepts only an on-chain basis-point protocol fee", () => {
    expect(toZapInProtocolFeeBps(5n)).toBe(5);
    expect(() => toZapInProtocolFeeBps(10_001n)).toThrow(
      "protocolFee must be between 0 and 10000 basis points",
    );
  });

  it("subtracts the protocol fee before it projects target-pool reserves", () => {
    const projection = projectZapInSplit({
      amountIn: 1_000_000n,
      selectedToken: "token0",
      reserve0: 10_000_000n,
      reserve1: 20_000_000n,
      swapMovesTargetReserves: true,
      protocolFeeBps: 50,
      splitBps: 5_000,
      amountOut: 500_000n,
    });

    expect(projection.postSwapReserve0).toBe(10_497_500n);
    expect(projection.postSwapReserve1).toBe(19_500_000n);
  });

  it("does not change target reserves when the swap route bypasses it", () => {
    const projection = projectZapInSplit({
      amountIn: 1_000_000n,
      selectedToken: "token1",
      reserve0: 20_000_000n,
      reserve1: 10_000_000n,
      swapMovesTargetReserves: false,
      protocolFeeBps: 50,
      splitBps: 6_667,
      amountOut: 666_700n,
    });

    expect(projection.postSwapReserve0).toBe(20_000_000n);
    expect(projection.postSwapReserve1).toBe(10_000_000n);
  });
});

describe("deriveBindingZapInPlan", () => {
  // These pure split cases use no protocol fee. The hook cases use the live
  // 50-basis-point fee and therefore select the adjacent basis-point splits.
  it.each([
    {
      selectedToken: "token0" as const,
      reserve0: 10_000_000n,
      reserve1: 20_000_000n,
      expectedSplitBps: 3_548,
    },
    {
      selectedToken: "token1" as const,
      reserve0: 20_000_000n,
      reserve1: 10_000_000n,
      expectedSplitBps: 6_452,
    },
  ])(
    "derives and verifies the final $selectedToken SDK split",
    ({ selectedToken, reserve0, reserve1, expectedSplitBps }) => {
      const plan = deriveBindingZapInPlan({
        prepared: makePreparedProbe(selectedToken),
        probeAmountOut: 500_000n,
        reserve0,
        reserve1,
        protocolFeeBps: 0,
      });
      const finalBuild = makeTransaction({
        selectedToken,
        amountInA: plan.projection.amountInA,
        amountInB: plan.projection.amountInB,
      });

      expect(plan.projection.splitBps).toBe(expectedSplitBps);
      expect(plan.projection.selectedTokenRefund).toBe(0n);
      expect(() =>
        assertBindingZapInPlan(finalBuild.zapIn, plan),
      ).not.toThrow();
    },
  );

  it("rejects an unsupported multi-hop counter-token route", () => {
    const prepared = makePreparedProbe("token0");
    prepared.details.routesB.push({
      from: TOKEN_1 as Address,
      to: TOKEN_0 as Address,
      factory: FACTORY as Address,
    });

    expect(() =>
      deriveBindingZapInPlan({
        prepared,
        probeAmountOut: 500_000n,
        reserve0: 10_000_000n,
        reserve1: 20_000_000n,
        protocolFeeBps: 0,
      }),
    ).toThrow("The counter-token zap leg must use one swap route");
  });

  it("rejects a nonlinear route through another pool", () => {
    const prepared = makePreparedProbe("token1");
    const swapRoute = prepared.details.routesA[0];
    if (!swapRoute) throw new Error("Expected a counter-token route");
    swapRoute.factory = ROUTER as Address;

    expect(() =>
      deriveBindingZapInPlan({
        prepared,
        probeAmountOut: 500_000n,
        reserve0: 20_000_000n,
        reserve1: 10_000_000n,
        protocolFeeBps: 0,
      }),
    ).toThrow("The counter-token zap route must use the target pool");
  });
});

describe("bindSelectedTokenMinimum", () => {
  it.each([
    { selectedToken: "token0" as const, amountInA: 355n, amountInB: 645n },
    { selectedToken: "token1" as const, amountInA: 645n, amountInB: 355n },
  ])(
    "sets and re-encodes the full retained $selectedToken minimum",
    ({ selectedToken, amountInA, amountInB }) => {
      const transaction = makeTransaction({
        selectedToken,
        amountInA,
        amountInB,
      });
      const result = bindSelectedTokenMinimum(
        transaction,
        RECIPIENT as Address,
      );
      const decoded = decodeFunctionData({
        abi: ROUTER_ABI,
        data: result.zapIn.params.data as `0x${string}`,
      });
      if (decoded.functionName !== "zapIn") {
        throw new Error("Expected zapIn calldata");
      }
      const encodedZapParams = decoded.args[3];

      expect(result.zapIn.amountInA + result.zapIn.amountInB).toBe(
        result.zapIn.amountIn,
      );
      expect(result.zapIn.zapParams.amountAMin).toBe(
        selectedToken === "token0" ? amountInA : 11n,
      );
      expect(result.zapIn.zapParams.amountBMin).toBe(
        selectedToken === "token1" ? amountInB : 22n,
      );
      expect(encodedZapParams.amountAMin).toBe(
        result.zapIn.zapParams.amountAMin,
      );
      expect(encodedZapParams.amountBMin).toBe(
        result.zapIn.zapParams.amountBMin,
      );
      expect(decoded.args[6]).toBe(RECIPIENT);
    },
  );

  it("rejects an SDK build whose split does not sum to the shown input", () => {
    const transaction = makeTransaction({
      selectedToken: "token1",
      amountInA: 645n,
      amountInB: 355n,
    });
    transaction.zapIn.amountIn += 1n;

    expect(() =>
      bindSelectedTokenMinimum(transaction, RECIPIENT as Address),
    ).toThrow("Zap-in split amounts do not sum to the input amount");
  });

  it("turns stale-state selected-token refunds into a strict-min failure", () => {
    const transaction = makeTransaction({
      selectedToken: "token1",
      amountInA: 645_200n,
      amountInB: 354_800n,
    });
    const bound = bindSelectedTokenMinimum(transaction, RECIPIENT as Address);

    const staleDeposit = quoteZapInDeposit(
      645_200n,
      354_800n,
      40_000_000n,
      5_000_000n,
    );

    expect(staleDeposit.amount1).toBeLessThan(354_800n);
    expect(bound.zapIn.zapParams.amountBMin).toBe(354_800n);
    expect(staleDeposit.amount1).toBeLessThan(bound.zapIn.zapParams.amountBMin);
  });
});
