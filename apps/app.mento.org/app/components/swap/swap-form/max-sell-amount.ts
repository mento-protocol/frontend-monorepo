import { formatUnits } from "viem";

const NATIVE_TOKEN_GAS_RESERVE_WEI = BigInt("10000000000000000"); // 0.01 CELO

interface GetMaxSellAmountParams {
  balanceInWei: string;
  decimals: number;
  isNativeToken: boolean;
}

export function getMaxSellAmount({
  balanceInWei,
  decimals,
  isNativeToken,
}: GetMaxSellAmountParams): string {
  let maxAmountInWei = balanceInWei;

  if (isNativeToken) {
    const balance = BigInt(balanceInWei);
    if (balance > NATIVE_TOKEN_GAS_RESERVE_WEI) {
      maxAmountInWei = (balance - NATIVE_TOKEN_GAS_RESERVE_WEI).toString();
    }
  }

  const formattedAmount = formatBalance(maxAmountInWei, decimals);
  return formatWithMaxDecimals(formattedAmount);
}

function formatBalance(value: string, decimals: number): string {
  try {
    const formatted = formatUnits(BigInt(value), decimals);
    const decimalPoint = formatted.indexOf(".");
    if (decimalPoint === -1) return formatted;
    return formatted.slice(0, decimalPoint + 5);
  } catch {
    return "0";
  }
}

function formatWithMaxDecimals(value: string): string {
  if (!value || value === "0") return "0";

  const [wholePart = "", decimalPart = ""] = value.split(".");
  const trimmedDecimals = decimalPart.replace(/0+$/, "");

  if (!trimmedDecimals) return wholePart;
  return `${wholePart}.${trimmedDecimals}`;
}
