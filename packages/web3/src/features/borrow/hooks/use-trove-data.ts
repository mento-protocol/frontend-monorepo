import { useQuery } from "@tanstack/react-query";
import type { BorrowPosition } from "../types";
import { useBorrowService } from "./use-borrow-service";

export function useTroveData(troveId: string | undefined, symbol = "GBPm") {
  const sdk = useBorrowService();

  return useQuery<BorrowPosition>({
    queryKey: ["borrow", "troveData", symbol, troveId],
    queryFn: () => sdk!.getTroveData(symbol, troveId!),
    enabled: !!sdk && !!troveId,
    refetchInterval: 15_000,
  });
}
