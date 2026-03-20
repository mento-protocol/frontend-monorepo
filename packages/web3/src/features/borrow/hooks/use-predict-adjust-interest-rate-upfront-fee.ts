import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "../../../utils/debounce";
import { useBorrowService } from "./use-borrow-service";

export function usePredictAdjustInterestRateUpfrontFee(
  troveId: string,
  interestRate: bigint,
  symbol = "GBPm",
) {
  const sdk = useBorrowService();
  const debouncedInterestRate = useDebounce(interestRate, 350);

  return useQuery<bigint>({
    queryKey: [
      "borrow",
      "adjustInterestRateUpfrontFee",
      symbol,
      troveId,
      debouncedInterestRate.toString(),
    ],
    queryFn: () =>
      sdk!.predictAdjustInterestRateUpfrontFee(
        symbol,
        troveId,
        debouncedInterestRate,
      ),
    enabled: !!sdk && troveId.length > 0 && debouncedInterestRate > 0n,
  });
}
