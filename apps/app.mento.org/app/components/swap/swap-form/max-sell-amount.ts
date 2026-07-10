import { formatBalance, formatWithMaxDecimals } from "@repo/web3";

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
  return formatWithMaxDecimals(formattedAmount, 4, false);
}
