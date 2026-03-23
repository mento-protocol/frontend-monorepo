import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useBorrowService } from "./use-borrow-service";

export function useNextAvailableOwnerIndex(symbol = "GBPm") {
  const sdk = useBorrowService();
  const { address } = useAccount();

  return useQuery<number>({
    queryKey: ["borrow", "nextAvailableOwnerIndex", symbol, address],
    queryFn: () => sdk!.findNextAvailableOwnerIndex(symbol, address!, address!),
    enabled: !!sdk && !!address,
  });
}

export function useNextOwnerIndex(symbol = "GBPm") {
  return useNextAvailableOwnerIndex(symbol);
}
