import type { DebtTokenConfig } from "./types";

const DECIMALS = 18;
const PLACEHOLDER = "—";

function bigintToNumber(value: bigint, decimals = DECIMALS): number {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  // Convert to number preserving reasonable precision
  return Number(whole) + Number(fraction) / Number(divisor);
}

export function formatDebtAmount(
  amount: bigint | null | undefined,
  debtToken: DebtTokenConfig,
): string {
  if (amount == null) return PLACEHOLDER;
  const num = bigintToNumber(amount);
  return new Intl.NumberFormat(debtToken.locale, {
    style: "currency",
    currency: debtToken.currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatCollateralAmount(
  amount: bigint | null | undefined,
): string {
  if (amount == null) return PLACEHOLDER;
  const num = bigintToNumber(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${formatted} USDm`;
}

export function formatPrice(
  price: bigint | null | undefined,
  debtToken: DebtTokenConfig,
): string {
  if (price == null) return PLACEHOLDER;
  const num = bigintToNumber(price);
  const formatted = new Intl.NumberFormat(debtToken.locale, {
    style: "currency",
    currency: debtToken.currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${formatted} per USDm`;
}

export function formatInterestRate(rate: bigint | null | undefined): string {
  if (rate == null) return PLACEHOLDER;
  const pct = bigintToNumber(rate) * 100;
  return `${pct.toFixed(2)}%`;
}

export function formatLtv(ltv: bigint | null | undefined): string {
  if (ltv == null) return PLACEHOLDER;
  const pct = bigintToNumber(ltv) * 100;
  // Use up to 1 decimal place, but avoid trailing zero noise
  const formatted = pct.toFixed(1);
  return `${formatted}%`;
}
