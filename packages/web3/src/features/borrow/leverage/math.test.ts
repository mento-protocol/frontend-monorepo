import { describe, expect, it } from "vitest";
import {
  getCloseFlashLoanAmount,
  getLeverDownTroveParams,
  getLeverUpTroveParams,
  getOpenLeveragedTroveParams,
} from "./math";

const WAD = 10n ** 18n;

describe("getOpenLeveragedTroveParams", () => {
  it("computes flash loan, expected debt, and max net debt with 5% slippage", () => {
    const result = getOpenLeveragedTroveParams(10n * WAD, 2.0, 2n * WAD);
    expect(result.flashLoanAmount).toBe(10n * WAD);
    expect(result.expectedBoldAmount).toBe(20n * WAD);
    // 105/100 slippage applied to the expected debt.
    expect(result.maxNetDebt).toBe(21n * WAD);
  });

  it("returns a zero flash loan when leverage factor is 1.0", () => {
    const result = getOpenLeveragedTroveParams(10n * WAD, 1.0, 2n * WAD);
    expect(result.flashLoanAmount).toBe(0n);
  });

  it("quantises leverage factors to 1/1000 steps (Math.round × 1000)", () => {
    // 2.0 and 2.0004 round to the same ×1000 integer (2000).
    const a = getOpenLeveragedTroveParams(10n * WAD, 2.0, 2n * WAD);
    const b = getOpenLeveragedTroveParams(10n * WAD, 2.0004, 2n * WAD);
    expect(b.flashLoanAmount).toBe(a.flashLoanAmount);
    expect(b.expectedBoldAmount).toBe(a.expectedBoldAmount);
    expect(b.maxNetDebt).toBe(a.maxNetDebt);
  });

  it("quantises 1.0005 up (Math.round of 1000.5 → 1001), producing a non-zero flash loan", () => {
    const result = getOpenLeveragedTroveParams(10n * WAD, 1.0005, 2n * WAD);
    // leverageRatio = 1001/1000 * WAD, so flashLoan = coll * (1/1000)
    expect(result.flashLoanAmount).toBe((10n * WAD) / 1000n);
  });

  it("handles a 1-wei collateral without overflow", () => {
    const result = getOpenLeveragedTroveParams(1n, 2.0, 2n * WAD);
    expect(result.flashLoanAmount).toBe(1n);
  });

  it("handles huge collateral values without overflow and stays monotonic", () => {
    const low = getOpenLeveragedTroveParams(10n ** 36n, 2.0, 2n * WAD);
    const high = getOpenLeveragedTroveParams(10n ** 36n, 3.0, 2n * WAD);
    expect(high.flashLoanAmount > low.flashLoanAmount).toBe(true);
    expect(low.flashLoanAmount).toBe(10n ** 36n);
  });
});

describe("getCloseFlashLoanAmount", () => {
  it("applies the default 5% slippage", () => {
    // 100e18 debt / 2e18 price = 50 collateral, × 1.05 = 52.5e18.
    expect(getCloseFlashLoanAmount(100n * WAD, 2n * WAD)).toBe(
      525n * 10n ** 17n,
    );
  });

  it("applies an explicit 0% slippage", () => {
    expect(getCloseFlashLoanAmount(100n * WAD, 2n * WAD, 0n)).toBe(50n * WAD);
  });
});

describe("getLeverUpTroveParams", () => {
  it("computes an increasing flash loan for a higher target leverage", () => {
    // currentCR 2.0 → currentLR 2.0; target 3.0 > 2.0 is valid.
    const currentCR = 2n * WAD;
    const result = getLeverUpTroveParams(10n * WAD, currentCR, 3.0, 2n * WAD);
    expect(result.flashLoanAmount > 0n).toBe(true);
    expect(result.effectiveBoldAmount > 0n).toBe(true);
  });

  it("throws when the target leverage is not higher than current", () => {
    const currentCR = 2n * WAD; // currentLR = 2.0
    expect(() =>
      getLeverUpTroveParams(10n * WAD, currentCR, 2.0, 2n * WAD),
    ).toThrow(/must increase/);
  });
});

describe("getLeverDownTroveParams", () => {
  it("computes a flash loan and minimum debt for a lower target leverage", () => {
    const currentCR = 15n * 10n ** 17n; // 1.5 → currentLR = 3.0
    const result = getLeverDownTroveParams(10n * WAD, currentCR, 2.0, 2n * WAD);
    expect(result.flashLoanAmount > 0n).toBe(true);
    expect(result.minBoldAmount > 0n).toBe(true);
  });

  it("throws when the target leverage is not lower than current", () => {
    const currentCR = 15n * 10n ** 17n; // 1.5 → currentLR = 3.0
    expect(() =>
      getLeverDownTroveParams(10n * WAD, currentCR, 3.0, 2n * WAD),
    ).toThrow(/must decrease/);
  });
});

describe("collateral-ratio boundary", () => {
  it("throws RangeError: Division by zero when currentCR equals 1.0", () => {
    // collateralRatioToLeverageRatio divides by (cr - 1e18); cr === 1e18 → /0.
    expect(() => getLeverUpTroveParams(10n * WAD, WAD, 3.0, 2n * WAD)).toThrow(
      RangeError,
    );
  });
});
