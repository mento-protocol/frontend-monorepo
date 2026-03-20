import { useQuery } from "@tanstack/react-query";
import type { SystemParams } from "../types";
import { useBorrowService } from "./use-borrow-service";

export function useSystemParams(symbol = "GBPm") {
  const sdk = useBorrowService();

  return useQuery<SystemParams>({
    queryKey: ["borrow", "systemParams", symbol],
    queryFn: () => sdk!.getSystemParams(symbol),
    enabled: !!sdk,
    staleTime: Infinity,
  });
}
