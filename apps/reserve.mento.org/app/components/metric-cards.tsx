import { IconInfo } from "./icon-info";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui";
import type { ReserveStats } from "@/app/lib/types";

interface MetricCardsProps {
  reserveStats: ReserveStats;
}

export function MetricCards({ reserveStats }: MetricCardsProps) {
  const collateralizationRatio = reserveStats.collateralization_ratio;
  const totalSupply = reserveStats.total_outstanding_stables_usd;
  const reserveHoldingsValue = reserveStats.total_reserve_value_usd;

  return (
    <div className="mb-8 mt-8 lg:mb-16 lg:mt-16 xl:mb-0">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground flex flex-row items-center justify-start gap-2">
          <Popover>
            <PopoverTrigger className="flex flex-row items-center justify-start gap-2">
              Total Supply
              <IconInfo />
            </PopoverTrigger>
            <PopoverContent className="max-w-xs">
              <p>
                The total amount of Mento stablecoins currently in circulation
                across all supported currencies.
              </p>
            </PopoverContent>
          </Popover>
        </span>
        <span className="leading-0 text-lg">
          $
          {totalSupply.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </span>
      </div>
      <hr className="my-3 border-[var(--border)] lg:my-4" />
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground flex flex-row items-center justify-start gap-2">
          <Popover>
            <PopoverTrigger className="flex flex-row items-center justify-start gap-2">
              Reserve Holdings
              <IconInfo />
            </PopoverTrigger>
            <PopoverContent className="max-w-xs">
              <p>
                The total value of assets held in the Mento Reserve. These
                assets back the stablecoins launched on the platform and are
                publicly verifiable at any time.
              </p>
            </PopoverContent>
          </Popover>
        </span>
        <span className="leading-0 text-lg">
          $
          {reserveHoldingsValue.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </span>
      </div>
      <hr className="my-3 border-[var(--border)] lg:my-4" />
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground flex flex-row items-center justify-start gap-2">
          <Popover>
            <PopoverTrigger className="flex flex-row items-center justify-start gap-2">
              Collateralization ratio
              <IconInfo />
            </PopoverTrigger>
            <PopoverContent className="max-w-xs">
              <p>
                The ratio between the total value of assets held in the Reserve
                and the total value of Mento stablecoins in circulation. A ratio
                above means all stablecoins are fully overcollateralized by
                Reserve assets.
              </p>
            </PopoverContent>
          </Popover>
        </span>
        <span className="leading-0 text-lg">
          {collateralizationRatio.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
