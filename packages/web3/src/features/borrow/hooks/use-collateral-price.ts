import { useQuery } from "@tanstack/react-query";
import { useBorrowService } from "./use-borrow-service";

export function useCollateralPrice(symbol = "GBPm") {
  const sdk = useBorrowService();

  return useQuery<bigint>({
    queryKey: ["borrow", "collateralPrice", symbol],
    queryFn: () => sdk!.getCollateralPrice(symbol),
    enabled: !!sdk,
    refetchInterval: 60_000,
  });
}
