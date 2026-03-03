import { useQuery } from "@tanstack/react-query";
import { useBorrowService } from "./use-borrow-service";

export function useBranchStats(symbol = "GBPm") {
  const sdk = useBorrowService();

  return useQuery({
    queryKey: ["borrow", "branchStats", symbol],
    queryFn: async () => {
      const [stats, avgInterestRate] = await Promise.all([
        sdk!.getBranchStats(symbol),
        sdk!.getAverageInterestRate(symbol),
      ]);
      return { ...stats, avgInterestRate };
    },
    enabled: !!sdk,
    refetchInterval: 60_000,
  });
}
