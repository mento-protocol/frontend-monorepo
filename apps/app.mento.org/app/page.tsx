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

import { Toaster, toast } from "@repo/ui";
import { IconCheck } from "@repo/ui";

export default function SwapPage() {
  const showChart = useAtomValue(showChartAtom);
  const [confirmView, setConfirmView] = useAtom(confirmViewAtom);

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
      {/* <Button
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
      </Button> */}
      <div className="mb-6 w-full max-w-xl">
        <div className="bg-card flex flex-col space-y-6 p-6">
          <div className="flex flex-row items-center justify-between gap-6">
            <h2 className="flex items-center gap-2 text-base font-medium md:text-lg">
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
