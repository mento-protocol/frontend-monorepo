import { describe, expect, it, vi } from "vitest";

const { parseAmountWithDefault } = vi.hoisted(() => {
  class ParsedAmount {
    constructor(private readonly value: number) {}

    gt(other: string | number) {
      return this.value > Number(other);
    }

    isZero() {
      return this.value === 0;
    }

    toFormat() {
      return this.value.toLocaleString("en-US");
    }
  }

  return {
    parseAmountWithDefault: (
      value: string | number | null | undefined,
      defaultValue: string | number,
    ) => {
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? new ParsedAmount(parsed)
        : new ParsedAmount(Number(defaultValue));
    },
  };
});

vi.mock("@repo/web3", () => ({
  parseAmountWithDefault,
}));

import {
  checkTradingLimitViolation,
  type SwapTradingLimits,
} from "./trading-limits";

const TOKEN_IN = "cUSD";
const TOKEN_OUT = "CELO";

function createLimits({
  direction,
  hopIndex = 0,
  tokenSymbol,
}: {
  direction: "in" | "out";
  hopIndex?: number;
  tokenSymbol: string;
}): SwapTradingLimits {
  return [
    {
      direction,
      hopIndex,
      tokenSymbol,
      L0: {
        maxIn: "1000",
        maxOut: "2000",
        total: "3000",
        until: 1_700_000_000,
      },
      L1: {
        maxIn: "4000",
        maxOut: "5000",
        total: "9000",
        until: 1_700_086_400,
      },
      LG: {
        maxIn: "10000",
        maxOut: "11000",
        total: "21000",
        until: 1_999_999_999,
      },
    },
  ];
}

function getExpectedDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString();
}

describe("checkTradingLimitViolation", () => {
  it("preserves the direct-route L0 input message", () => {
    const limits = createLimits({
      direction: "in",
      tokenSymbol: TOKEN_IN,
    });

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["1000.01", "0"],
        limits,
      }),
    ).toBe(
      `The ${TOKEN_IN} amount exceeds the current trading limit of 1,000 ${TOKEN_IN} within 5min. It will be reset again to 3,000 ${TOKEN_IN} at ${getExpectedDate(limits[0]!.L0!.until)}.`,
    );
  });

  it("allows an input amount equal to the active limit", () => {
    const limits = createLimits({
      direction: "in",
      tokenSymbol: TOKEN_IN,
    });

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["1000", "0"],
        limits,
      }),
    ).toBeNull();
  });

  it("allows an output amount equal to the active limit", () => {
    const limits = createLimits({
      direction: "out",
      tokenSymbol: TOKEN_OUT,
    });

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["0", "2000"],
        limits,
      }),
    ).toBeNull();
  });

  it("preserves the direct-route L1 input message", () => {
    const limits = createLimits({
      direction: "in",
      tokenSymbol: TOKEN_IN,
    });
    limits[0] = {
      ...limits[0]!,
      LG: { ...limits[0]!.LG!, maxIn: "999999" },
      L0: { ...limits[0]!.L0!, maxIn: "999999" },
    };

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["4000.01", "0"],
        limits,
      }),
    ).toBe(
      `The ${TOKEN_IN} amount exceeds the current trading limit of 4,000 ${TOKEN_IN} within 1d. It will be reset again to 9,000 ${TOKEN_IN} at ${getExpectedDate(limits[0]!.L1!.until)}.`,
    );
  });

  it("preserves the direct-route global output message", () => {
    const limits = createLimits({
      direction: "out",
      tokenSymbol: TOKEN_OUT,
    });
    limits[0] = {
      ...limits[0]!,
      L0: { ...limits[0]!.L0!, maxOut: "999999" },
      L1: { ...limits[0]!.L1!, maxOut: "999999" },
    };

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["0", "11000.01"],
        limits,
      }),
    ).toBe(
      `Cannot buy more than 11,000 ${TOKEN_OUT}. This exceeds the global trading limit.`,
    );
  });

  it("checks the intermediate output amount in a two-hop route", () => {
    const limits = createLimits({
      direction: "out",
      tokenSymbol: "USDm",
    });

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["1", "2000.01", "1.9"],
        limits,
      }),
    ).toContain("Cannot buy more than 2,000 USDm within 5min");
  });

  it("checks the second-hop input amount in a three-hop route", () => {
    const limits = createLimits({
      direction: "in",
      hopIndex: 1,
      tokenSymbol: "USDm",
    });

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["1", "1000.01", "0.9", "0.8"],
        limits,
      }),
    ).toContain("The USDm amount exceeds the current trading limit");
  });

  it("uses reverse-route hop positions", () => {
    const limits = createLimits({
      direction: "out",
      hopIndex: 1,
      tokenSymbol: "USDm",
    });

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["1 EUROP", "1 EURm", "2000.01", "1 USDC"],
        limits,
      }),
    ).toContain("Cannot buy more than 2,000 USDm");
  });

  it("checks all configured assets and returns the first route violation", () => {
    const firstHopLimits = createLimits({
      direction: "in",
      tokenSymbol: "USDC",
    });
    const lastHopLimits = createLimits({
      direction: "out",
      hopIndex: 2,
      tokenSymbol: "EUROP",
    });

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["1000.01", "1", "1", "2000.01"],
        limits: [...firstHopLimits, ...lastHopLimits],
      }),
    ).toContain("USDC");
  });

  it("treats zero remaining capacity as exhausted", () => {
    const limits = createLimits({
      direction: "in",
      tokenSymbol: TOKEN_IN,
    });
    limits[0] = {
      ...limits[0]!,
      L0: {
        maxIn: "0",
        maxOut: "0",
        total: "0",
        until: 1_700_000_000,
      },
      L1: null,
      LG: null,
    };

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["10", "0"],
        limits,
      }),
    ).toContain(`current trading limit of 0 ${TOKEN_IN}`);

    expect(
      checkTradingLimitViolation({
        routeAmounts: ["0", "0"],
        limits,
      }),
    ).toBeNull();
  });
});
