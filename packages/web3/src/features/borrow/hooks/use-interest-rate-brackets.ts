import { useQuery } from "@tanstack/react-query";
import { useBorrowService } from "./use-borrow-service";

export function useInterestRateBrackets(symbol = "GBPm") {
  const sdk = useBorrowService();

  return useQuery({
    queryKey: ["borrow", "interestRateBrackets", symbol],
    queryFn: () => sdk!.getInterestRateBrackets(symbol),
    enabled: !!sdk,
    refetchInterval: 60_000,
  });
}
