import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { BorrowPosition } from "../types";
import { useBorrowService } from "./use-borrow-service";

export function useUserTroves(symbol = "GBPm") {
  const sdk = useBorrowService();
  const { address } = useAccount();

  return useQuery<BorrowPosition[]>({
    queryKey: ["borrow", "userTroves", symbol, address],
    queryFn: () => sdk!.getUserTroves(symbol, address!),
    enabled: !!sdk && !!address,
    refetchInterval: 15_000,
  });
}
