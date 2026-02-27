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

  // Count integer digits to choose the suffix without parseFloat precision loss.
  // Split on "." to isolate the integer part, then strip leading zeros.
  const intPart = (unsigned.split(".")[0] || "0").replace(/^0+/, "") || "0";
  const intDigits = intPart.length;

  // For M/K: divide the string value by the suffix scale, then parseFloat the
  // small result so we never lose precision on the original large number.
  if (intDigits >= 7) {
    const scaled = parseFloat(unsigned) / MILLION;
    return sign + scaled.toFixed(2) + "M";
  }
  if (intDigits >= 4) {
    const scaled = parseFloat(unsigned) / THOUSAND;
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
