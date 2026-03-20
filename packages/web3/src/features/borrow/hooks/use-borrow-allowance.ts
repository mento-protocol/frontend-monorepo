import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useBorrowService } from "./use-borrow-service";

export function useBorrowAllowance(symbol = "GBPm", spender?: string) {
  const sdk = useBorrowService();
  const { address } = useAccount();

  return useQuery({
    queryKey: ["borrow", "allowance", symbol, address, spender],
    queryFn: async () => {
      const collateralAllowance = await sdk!.getCollateralAllowance(
        symbol,
        address!,
      );
      const debtAllowance = spender
        ? await sdk!.getDebtAllowance(symbol, address!, spender)
        : 0n;
      return { collateralAllowance, debtAllowance };
    },
    enabled: !!sdk && !!address,
  });
}
