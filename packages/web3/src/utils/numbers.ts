import { formatUnits } from "viem";

export const TRILLION = 1000000000000000;
export const BILLION = 1000000000;
export const MILLION = 1000000;
export const THOUSAND = 1000;

export abstract class NumbersService {
  public static scaleBalance(
    value: bigint,
    decimals: number = 18,
    precision: number = 3,
  ): number {
    return (
      Number(value / BigInt(10 ** (decimals - precision))) / 10 ** precision
    );
  }

  public static parseNumericValue(
    value: number | string,
    precision: number = 1,
  ): string {
    if (!value || +value <= 0) {
      return "0";
    }

    if (+value / TRILLION >= 1) {
      return `${(+value / TRILLION).toFixed((+value / TRILLION) % 1 ? precision : 0)}T`;
    }
    if (+value / BILLION >= 1) {
      return `${(+value / BILLION).toFixed((+value / BILLION) % 1 ? precision : 0)}B`;
    }
    if (+value / MILLION >= 1) {
      return `${(+value / MILLION).toFixed((+value / MILLION) % 1 ? precision : 0)}M`;
    }
    if (+value / THOUSAND >= 1) {
      return `${(+value / THOUSAND).toFixed((+value / THOUSAND) % 1 ? precision : 0)}K`;
    }

    return (+value).toFixed(0);
  }
}

export function formatCompactBalance(balance: string): string {
  const trimmed = balance.trim();
  if (!trimmed || trimmed === "NaN") return "0";

  const sign = trimmed.startsWith("-") ? "-" : "";
  const unsigned = sign ? trimmed.slice(1) : trimmed;

  // Normalize scientific-notation strings (e.g. "1e10") to plain decimal so
  // the digit count below reflects the true integer magnitude.
  let forCounting = unsigned;
  if (/[eE]/.test(unsigned)) {
    const n = Number(unsigned);
    if (Number.isFinite(n) && n >= 1) {
      forCounting = n.toFixed(0);
    }
  }

  // Count integer digits to choose the suffix without parseFloat precision loss.
  // Split on "." to isolate the integer part, then strip leading zeros.
  const intPart = (forCounting.split(".")[0] || "0").replace(/^0+/, "") || "0";
  const intDigits = intPart.length;

  // parseFloat(unsigned) can lose precision for integers beyond
  // Number.MAX_SAFE_INTEGER (~9e15). For values with <=15 integer digits we
  // use standard floating-point division; for larger values we fall back to
  // BigInt-based scaling. We also guard against malformed inputs that would
  // produce NaN or Infinity.
  if (intDigits >= 7) {
    if (intDigits <= 15) {
      const scaled = parseFloat(unsigned) / MILLION;
      if (!Number.isFinite(scaled)) return "0";
      return sign + scaled.toFixed(2) + "M";
    }

    try {
      const big = BigInt(intPart);
      const scaledX100 = (big * 100n) / BigInt(MILLION);
      const whole = scaledX100 / 100n;
      const frac = scaledX100 % 100n;
      return (
        sign + whole.toString() + "." + frac.toString().padStart(2, "0") + "M"
      );
    } catch {
      return "0";
    }
  }
  if (intDigits >= 4) {
    const scaled = parseFloat(unsigned) / THOUSAND;
    if (!Number.isFinite(scaled)) return "0";
    return sign + scaled.toFixed(2) + "K";
  }

  const num = parseFloat(unsigned);
  if (!Number.isFinite(num)) return "0";

  return (
    sign +
    num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

export const formatUnitsWithRadix = (
  value: bigint,
  decimals: number,
  radix: number,
) => parseFloat(formatUnits(value, decimals)).toFixed(radix);

export const formatUnitsWithThousandSeparators = (
  value: bigint,
  decimals: number,
  radix: number,
) => {
  const parsedValue = parseFloat(formatUnits(value, decimals));
  const formattedValue = parsedValue.toFixed(radix);
  const [integerPart, decimalPart = ""] = formattedValue.split(".");

  if (!integerPart) throw new Error("integerPart is undefined");
  const integerWithSeparators = integerPart.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );

  if (decimalPart && parseFloat(`0.${decimalPart}`) !== 0) {
    return `${integerWithSeparators}.${decimalPart}`;
  }

  return integerWithSeparators;
};
