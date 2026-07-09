import type { BorrowService } from "@mento-protocol/mento-sdk";
import type { CallParams } from "../types";

type CloseTroveApprovalSdk = Pick<
  BorrowService,
  "getDebtAllowance" | "buildDebtApprovalParams"
>;

// closeTrove pulls entireDebt at execution time and interest accrues per
// second, so an exact-amount approval can revert between quote and
// confirmation. +0.1% covers ~7 days of accrual at 5% APR.
export function computeBufferedDebt(debt: bigint): bigint {
  return (debt * 1001n) / 1000n;
}

export async function buildCloseTroveApprovalCall(
  sdk: CloseTroveApprovalSdk,
  symbol: string,
  account: string,
  borrowerOperations: string,
  debt: bigint,
): Promise<CallParams | null> {
  const bufferedDebt = computeBufferedDebt(debt);
  const allowance = await sdk.getDebtAllowance(
    symbol,
    account,
    borrowerOperations,
  );
  if (allowance >= bufferedDebt) return null;
  return sdk.buildDebtApprovalParams(symbol, borrowerOperations, bufferedDebt);
}
