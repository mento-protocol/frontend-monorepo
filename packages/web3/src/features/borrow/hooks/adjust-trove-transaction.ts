import type { BorrowService } from "@mento-protocol/mento-sdk";
import type { AdjustTroveParams, CallParams, TroveStatus } from "../types";

type AdjustTroveSdk = Pick<
  BorrowService,
  "buildAdjustTroveTransaction" | "buildAdjustZombieTroveTransaction"
>;

export function buildAdjustTroveCall(
  sdk: AdjustTroveSdk,
  symbol: string,
  params: AdjustTroveParams,
  troveStatus: TroveStatus,
): Promise<CallParams> {
  if (troveStatus === "zombie") {
    return sdk.buildAdjustZombieTroveTransaction(symbol, params);
  }

  return sdk.buildAdjustTroveTransaction(symbol, params);
}
