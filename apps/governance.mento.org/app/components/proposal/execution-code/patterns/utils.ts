import { formatUnits } from "viem";
import type { Transaction } from "../../types/transaction";

export function formatTokenAmount(
  amount: string | number,
  decimals: number,
): string {
  try {
    const formatted = formatUnits(BigInt(amount), decimals);
    const num = parseFloat(formatted);

    // Use native Intl.NumberFormat for compact notation (K/M suffixes)
    const formatter = new Intl.NumberFormat("en-US", {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 4,
    });

    return formatter.format(num);
  } catch {
    return String(amount);
  }
}

/**
 * Checks if a transaction is empty (zero address with no calldata and zero value)
 */
export function isEmptyTransaction(tx: Transaction): boolean {
  return (
    tx.address === "0x0000000000000000000000000000000000000000" &&
    (tx.data === "0x" || tx.data === "") &&
    Number(tx.value) === 0
  );
}
