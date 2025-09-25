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

  public static formatCompactNumber(value: string, precision = 1): string {
    const n = Number(value);
    if (isNaN(n) || !Number.isFinite(n) || n <= 0) return "0";

    const UNITS = [
      { v: 1e12, s: "T" },
      { v: 1e9,  s: "B" },
      { v: 1e6,  s: "M" },
      { v: 1e3,  s: "K" },
    ] as const;

    for (const { v, s } of UNITS) {
      if (n >= v) {
        const scaled = n / v;
        const dp = Number.isInteger(scaled) ? 0 : precision;
        return `${scaled.toFixed(dp)}${s}`;
      }
    }

    return n.toFixed(0);
  }
}
