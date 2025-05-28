"use client";

import { useAtom, useAtomValue } from "jotai";
import { SlippageModal } from "./components/swap/slippage-modal";
import { SwapConfirm } from "./components/swap/swap-confirm";
import SwapForm from "./components/swap/swap-form";
import { PriceChartCelo } from "./features/chart/price-chart-celo";
import { confirmViewAtom, showChartAtom } from "./features/swap/swap-atoms";
import { config } from "./lib/config/config";
import { TokenId } from "./lib/config/tokens";
import { Button } from "@repo/ui";
import { ArrowLeft } from "lucide-react";

export default function SwapPage() {
  const showChart = useAtomValue(showChartAtom);
  const [confirmView, setConfirmView] = useAtom(confirmViewAtom);

  return (
    <div className="flex h-full w-full flex-wrap items-center justify-center">
      <div className="mb-6 w-full max-w-xl">
        <div className="bg-card flex flex-col space-y-6 p-6">
          <div className="flex flex-row items-center justify-between gap-6">
            <h2 className="flex items-center gap-2 text-lg font-medium">
              {confirmView ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setConfirmView(false)}
                >
                  <ArrowLeft />
                </Button>
              ) : null}
              {confirmView ? "Confirm Swap" : "Swap"}
            </h2>
            <SlippageModal />
          </div>
          {confirmView ? <SwapConfirm /> : <SwapForm />}
        </div>
      </div>
      {config.showPriceChart && showChart && (
        <div className="mb-6 md:ml-10">
          <PriceChartCelo stableTokenId={TokenId.cUSD} height={265} />
        </div>
      )}
    </div>
  );
}
