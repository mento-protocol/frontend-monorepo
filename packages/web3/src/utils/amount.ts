import { formatUnits, parseUnits } from "@ethersproject/units";
import BigNumber from "bignumber.js";
import {
  DISPLAY_DECIMALS,
  MIN_ROUNDED_VALUE,
  STANDARD_TOKEN_DECIMALS,
} from "@/config/constants";
import { logger } from "@/utils/logger";

export type NumberT = BigNumber.Value;

export function fromWei(
  value: NumberT | null | undefined,
  decimals = STANDARD_TOKEN_DECIMALS,
): string {
  if (!value) return "0";
  const valueString = value.toString().trim();
  const flooredValue = new BigNumber(valueString).toFixed(
    0,
    BigNumber.ROUND_FLOOR,
  );
  return formatUnits(flooredValue, decimals);
}

// Similar to fromWei above but rounds to set number of decimals
// with a minimum floor, configured per token
export function fromWeiRounded(
  value: NumberT | null | undefined,
  decimals = STANDARD_TOKEN_DECIMALS,
  roundDownIfSmall = true,
): string {
  if (!value) return "0";
  const flooredValue = new BigNumber(value).toFixed(0, BigNumber.ROUND_FLOOR);
  const amount = new BigNumber(formatUnits(flooredValue, decimals));
  if (amount.isZero()) return "0";

  // If amount is less than min value
  if (amount.lt(MIN_ROUNDED_VALUE)) {
    if (roundDownIfSmall) return "0";
    return MIN_ROUNDED_VALUE.toString();
  }

  return amount.toFixed(DISPLAY_DECIMALS).toString();
}

export function toWei(
  value: NumberT | null | undefined,
  decimals = STANDARD_TOKEN_DECIMALS,
): BigNumber {
  if (!value) return new BigNumber(0);
  const valueString = new BigNumber(value).toFixed().trim();
  const components = valueString.split(".");
  if (components.length === 1) {
    return new BigNumber(parseUnits(valueString, decimals).toString());
  }
  if (components.length === 2) {
    const trimmedFraction = components?.[1]?.substring(0, decimals);
    return new BigNumber(
      parseUnits(`${components[0]}.${trimmedFraction}`, decimals).toString(),
    );
  }
  throw new Error(`Cannot convert ${valueString} to wei`);
}

export function parseAmount(
  value: NumberT | null | undefined,
): BigNumber | null {
  try {
    if (!value) return null;
    const parsed = new BigNumber(value);
    if (!parsed || parsed.isNaN() || !parsed.isFinite()) return null;
    return parsed;
  } catch {
    logger.warn("Error parsing amount", value);
    return null;
  }
}

export function parseAmountWithDefault(
  value: NumberT | null | undefined,
  defaultValue: NumberT,
): BigNumber {
  return parseAmount(value) ?? new BigNumber(defaultValue);
}
