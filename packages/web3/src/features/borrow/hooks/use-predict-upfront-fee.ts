import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "../../../utils/debounce";
import { useBorrowService } from "./use-borrow-service";

export function usePredictUpfrontFee(
  borrowAmount: bigint,
  interestRate: bigint,
  symbol = "GBPm",
) {
  const sdk = useBorrowService();
  const debouncedBorrowAmount = useDebounce(borrowAmount, 350);

  return useQuery<bigint>({
    queryKey: [
      "borrow",
      "upfrontFee",
      symbol,
      debouncedBorrowAmount.toString(),
      interestRate.toString(),
    ],
    queryFn: () =>
      sdk!.predictOpenTroveUpfrontFee(
        symbol,
        debouncedBorrowAmount,
        interestRate,
      ),
    enabled: !!sdk && debouncedBorrowAmount > 0n,
  });
}
