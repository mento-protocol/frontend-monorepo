/**
 * Leverage math functions extracted from BOLD (liquity-leverage.ts).
 *
 * All functions are pure — no side effects, no contract calls.
 * All bigint values use 18-decimal fixed-point (1e18 = 1.0).
 */

const DECIMAL_PRECISION = 10n ** 18n;

/** Default slippage tolerance for leverage operations (5%). */
const SLIPPAGE_NUMERATOR = 105n;
const SLIPPAGE_DENOMINATOR = 100n;

/** Default slippage for close-from-collateral (5%). */
const CLOSE_SLIPPAGE_PERCENT = 5n;

/**
 * Convert a collateral ratio (ICR) to a leverage ratio.
 * leverageRatio = CR * 1e18 / (CR - 1e18)
 */
function collateralRatioToLeverageRatio(cr: bigint): bigint {
  return (cr * DECIMAL_PRECISION) / (cr - DECIMAL_PRECISION);
}

/**
 * Convert a leverage factor (JS number like 2.5) to an 18-decimal bigint.
 * Uses integer math via ×1000 to avoid floating-point precision issues.
 */
function leverageFactorToBigint(leverageFactor: number): bigint {
  return (
    (BigInt(Math.round(leverageFactor * 1000)) * DECIMAL_PRECISION) / 1000n
  );
}

/**
 * Compute parameters for opening a leveraged trove.
 *
 * @param collAmount - Initial collateral deposit (18-decimal bigint)
 * @param leverageFactor - Desired leverage multiplier (e.g. 2.0 = 2× leverage)
 * @param price - Current collateral price in debt token (18-decimal bigint)
 * @returns Flash loan amount, expected debt, and max net debt (with slippage)
 */
export function getOpenLeveragedTroveParams(
  collAmount: bigint,
  leverageFactor: number,
  price: bigint,
): {
  flashLoanAmount: bigint;
  expectedBoldAmount: bigint;
  maxNetDebt: bigint;
} {
  const leverageRatio = leverageFactorToBigint(leverageFactor);
  const flashLoanAmount =
    (collAmount * (leverageRatio - DECIMAL_PRECISION)) / DECIMAL_PRECISION;
  const expectedBoldAmount = (flashLoanAmount * price) / DECIMAL_PRECISION;
  const maxNetDebt =
    (expectedBoldAmount * SLIPPAGE_NUMERATOR) / SLIPPAGE_DENOMINATOR;

  return {
    flashLoanAmount,
    expectedBoldAmount,
    maxNetDebt,
  };
}

/**
 * Compute parameters for increasing leverage on an existing trove.
 *
 * @param currentCollAmount - Current trove collateral (18-decimal bigint)
 * @param currentCR - Current individual collateral ratio / ICR (18-decimal bigint)
 * @param leverageFactor - Target leverage multiplier (must be higher than current)
 * @param price - Current collateral price in debt token (18-decimal bigint)
 * @returns Flash loan amount and max net debt increase (with slippage)
 * @throws If target leverage is not higher than current
 */
export function getLeverUpTroveParams(
  currentCollAmount: bigint,
  currentCR: bigint,
  leverageFactor: number,
  price: bigint,
): {
  flashLoanAmount: bigint;
  effectiveBoldAmount: bigint;
} {
  const currentLR = collateralRatioToLeverageRatio(currentCR);
  const leverageRatio = leverageFactorToBigint(leverageFactor);

  if (leverageRatio <= currentLR) {
    throw new Error(
      `Leverage ratio must increase: target ${leverageRatio} <= current ${currentLR}`,
    );
  }

  const flashLoanAmount =
    (currentCollAmount * leverageRatio) / currentLR - currentCollAmount;
  const expectedBoldAmount = (flashLoanAmount * price) / DECIMAL_PRECISION;
  const maxNetDebtIncrease =
    (expectedBoldAmount * SLIPPAGE_NUMERATOR) / SLIPPAGE_DENOMINATOR;

  return {
    flashLoanAmount,
    effectiveBoldAmount: maxNetDebtIncrease,
  };
}

/**
 * Compute parameters for decreasing leverage on an existing trove.
 *
 * @param currentCollAmount - Current trove collateral (18-decimal bigint)
 * @param currentCR - Current individual collateral ratio / ICR (18-decimal bigint)
 * @param leverageFactor - Target leverage multiplier (must be lower than current)
 * @param price - Current collateral price in debt token (18-decimal bigint)
 * @returns Flash loan amount and minimum debt repayment (with slippage)
 * @throws If target leverage is not lower than current
 */
export function getLeverDownTroveParams(
  currentCollAmount: bigint,
  currentCR: bigint,
  leverageFactor: number,
  price: bigint,
): {
  flashLoanAmount: bigint;
  minBoldAmount: bigint;
} {
  const currentLR = collateralRatioToLeverageRatio(currentCR);
  const leverageRatio = leverageFactorToBigint(leverageFactor);

  if (leverageRatio >= currentLR) {
    throw new Error(
      `Leverage ratio must decrease: target ${leverageRatio} >= current ${currentLR}`,
    );
  }

  const flashLoanAmount =
    currentCollAmount - (currentCollAmount * leverageRatio) / currentLR;
  const expectedBoldAmount = (flashLoanAmount * price) / DECIMAL_PRECISION;
  const minBoldDebt =
    (expectedBoldAmount * (SLIPPAGE_DENOMINATOR - CLOSE_SLIPPAGE_PERCENT)) /
    SLIPPAGE_DENOMINATOR;

  return {
    flashLoanAmount,
    minBoldAmount: minBoldDebt,
  };
}

/**
 * Compute the flash loan amount needed to close a leveraged trove from collateral.
 *
 * @param entireDebt - Total trove debt including interest (18-decimal bigint)
 * @param price - Current collateral price in debt token (18-decimal bigint)
 * @param slippagePercent - Slippage tolerance as a whole number (default 5 = 5%)
 * @returns Flash loan collateral amount needed
 */
export function getCloseFlashLoanAmount(
  entireDebt: bigint,
  price: bigint,
  slippagePercent: bigint = CLOSE_SLIPPAGE_PERCENT,
): bigint {
  return (
    (((entireDebt * DECIMAL_PRECISION) / price) * (100n + slippagePercent)) /
    100n
  );
}
