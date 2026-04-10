import { IconInfo } from "@repo/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui";
import type { V2OverviewResponse } from "@/lib/types";

interface MetricCardsProps {
  overview: V2OverviewResponse;
}

export function MetricCards({ overview }: MetricCardsProps) {
  const { supply, reserve_backing } = overview;

  return (
    <div className="mb-8 mt-8 lg:mb-16 lg:mt-16 xl:mb-0">
      <div className="flex items-center justify-between">
        <span className="gap-2 flex flex-row items-center justify-start text-muted-foreground">
          <Popover>
            <PopoverTrigger className="gap-2 flex flex-row items-center justify-start">
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
          {supply.total_usd.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </span>
      </div>
      <hr className="my-3 lg:my-4 border-[var(--border)]" />
      <div className="flex items-center justify-between">
        <span className="gap-2 flex flex-row items-center justify-start text-muted-foreground">
          <Popover>
            <PopoverTrigger className="gap-2 flex flex-row items-center justify-start">
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
          {reserve_backing.collateral_usd.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </span>
      </div>
      <hr className="my-3 lg:my-4 border-[var(--border)]" />
      <div className="flex items-center justify-between">
        <span className="gap-2 flex flex-row items-center justify-start text-muted-foreground">
          <Popover>
            <PopoverTrigger className="gap-2 flex flex-row items-center justify-start">
              Collateralization ratio
              <IconInfo />
            </PopoverTrigger>
            <PopoverContent className="max-w-xs">
              <p>
                The ratio between the total value of assets held in the Reserve
                and the total value of Mento stablecoins in circulation. A ratio
                above 1 means all stablecoins are fully overcollateralized by
                Reserve assets.
              </p>
            </PopoverContent>
          </Popover>
        </span>
        <span className="leading-0 text-lg">
          {reserve_backing.ratio.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
