import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useBorrowService } from "./use-borrow-service";

export function useNextOwnerIndex(symbol = "GBPm") {
  const sdk = useBorrowService();
  const { address } = useAccount();

  return useQuery<number>({
    queryKey: ["borrow", "nextOwnerIndex", symbol, address],
    queryFn: () => sdk!.getNextOwnerIndex(symbol, address!),
    enabled: !!sdk && !!address,
  });
}
