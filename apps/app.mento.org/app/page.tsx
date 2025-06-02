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

import { Toaster } from "@repo/ui";
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
      <div className="relative mb-6 w-full max-w-xl">
        <div className="top-decorations before:bg-primary after:bg-card after:-top-15 before:absolute before:-left-5 before:-top-5 before:block before:h-5 before:w-5 after:absolute after:left-0 after:block after:h-10 after:w-10"></div>
        <div className="bg-card flex h-[540px] flex-col space-y-6 p-6">
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
        <div className="bottom-decorations before:bg-card after:bg-card after:-bottom-15 before:absolute before:-bottom-5 before:-right-5 before:block before:h-5 before:w-5 before:invert after:absolute after:right-0 after:block after:h-10 after:w-10"></div>
      </div>
      {config.showPriceChart && showChart && (
        <div className="mb-6 h-[265px] md:ml-10">
          <PriceChartCelo stableTokenId={TokenId.cUSD} height={265} />
        </div>
      )}
    </div>
  );
}
