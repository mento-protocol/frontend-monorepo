"use client";

import { PriceChartCelo } from "./features/chart/price-chart-celo";
import { useAtomValue } from "jotai";
import {
  formValuesAtom,
  showChartAtom,
  confirmViewAtom,
} from "./features/swap/swap-atoms";
import { SwapFormCard } from "./components/new/swap/new-swap-form-card";
import { SwapConfirmCard } from "./components/new/swap/new-swap-confirm-card";
import { config } from "./lib/config/config";
import { TokenId } from "./lib/config/tokens";

import { Toaster, toast } from "@repo/ui";
import { Button } from "@repo/ui";
import { IconCheck } from "@repo/ui";

export default function SwapPage() {
  const formValues = useAtomValue(formValuesAtom);
  const showChart = useAtomValue(showChartAtom);
  const confirmView = useAtomValue(confirmViewAtom);

  return (
    <div className="flex h-full w-full flex-wrap items-center justify-center">
      <Toaster
        position="top-right"
        icons={{
          success: <IconCheck />,
        }}
        toastOptions={{
          classNames: {
            toast: "toast",
            title: "title",
            description: "description",
            actionButton: "action-button",
            cancelButton: "cancel-button",
            closeButton: "close-button",
          },
        }}
        offset={{ top: "80px" }}
        mobileOffset={{ top: "96px" }}
      />
      <Button
        variant="outline"
        onClick={() =>
          toast.success("Swap Successful", {
            duration: 5000,
            description: () => (
              <>
                You’ve swapped 2,000 CELO for 700 cUSD. <br />{" "}
                <a href="#">View Transaction on CeloScan</a>
              </>
            ),
          })
        }
      >
        Show Toast
      </Button>

      <div className="mb-6 w-full max-w-lg">
        {!formValues || !confirmView ? <SwapFormCard /> : <SwapConfirmCard />}
      </div>
      {config.showPriceChart && showChart && (
        <div className="mb-6 md:ml-10">
          <PriceChartCelo stableTokenId={TokenId.cUSD} height={265} />
        </div>
      )}
    </div>
  );
}
