"use client";

import { PriceChartCelo } from "./features/chart/price-chart-celo";
import { useAtomValue } from "jotai";
import {
  formValuesAtom,
  showChartAtom,
  confirmViewAtom,
} from "./features/swap/swap-atoms";
import { SwapConfirmCard } from "./features/swap/swap-confirm";
import { SwapFormCard } from "./features/swap/swap-form";
import { config } from "./lib/config/config";
import { TokenId } from "./lib/config/tokens";

import { NewSwapFormCard } from "./components/new/swap/new-swap-form-card";

export default function SwapPage() {
  const formValues = useAtomValue(formValuesAtom);
  const showChart = useAtomValue(showChartAtom);
  const confirmView = useAtomValue(confirmViewAtom);

  return (
    <div className="flex h-full w-full flex-wrap items-center justify-center">
      <div className="mb-6 w-full max-w-lg">
        {!formValues || !confirmView ? (
          <>
            {/* <SwapFormCard /> */}
            <NewSwapFormCard />
          </>
        ) : (
          <SwapConfirmCard formValues={formValues} />
        )}
      </div>
      {config.showPriceChart && showChart && (
        <div className="mb-6 md:ml-10">
          <PriceChartCelo stableTokenId={TokenId.cUSD} height={265} />
        </div>
      )}
    </div>
  );
}
