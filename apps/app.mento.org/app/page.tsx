"use client";

import { useAtom } from "jotai";
import { ArrowLeft } from "lucide-react";
import { SlippageDialog } from "./components/swap/slippage-dialog";
import { SwapConfirm } from "./components/swap/swap-confirm";
import SwapForm from "./components/swap/swap-form";
import { confirmViewAtom } from "@repo/web3";

import { Button, cn, DebugPopup, IconCheck, Toaster } from "@repo/ui";

export default function SwapPage() {
  const [confirmView, setConfirmView] = useAtom(confirmViewAtom);
  const shouldEnableDebug = process.env.NEXT_PUBLIC_ENABLE_DEBUG === "true";

  return (
    <>
      <div className="flex h-full w-full flex-wrap items-center justify-center">
        {shouldEnableDebug && <DebugPopup />}
        <Toaster
          position="top-right"
          duration={5000}
          icons={{
            success: <IconCheck className="text-success" />,
          }}
          closeButton
          toastOptions={{
            classNames: {
              toast: "toast",
              title: "title",
              description: "description",
              actionButton: "action-button",
              cancelButton: "cancel-button",
              closeButton: "close-button",
              icon: "icon",
            },
          }}
          offset={{ top: "80px" }}
          mobileOffset={{ top: "96px" }}
        />
        <div className="mb-6 relative w-full max-w-[568px]">
          <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
          <div
            className={cn(
              "space-y-6 p-6 md:h-[510px] relative z-50 flex flex-col bg-card",
              confirmView ? "h-[calc(100vh-160px)]" : "h-[510px]",
            )}
          >
            <div className="gap-6 flex flex-row items-center justify-between">
              <h2 className="gap-2 font-medium md:text-2xl flex items-center">
                {confirmView ? (
                  <Button
                    data-testid="backButton"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setConfirmView(false)}
                  >
                    <ArrowLeft />
                  </Button>
                ) : null}
                {confirmView ? "Confirm Swap" : "Swap"}
              </h2>
              <SlippageDialog />
            </div>
            {confirmView ? <SwapConfirm /> : <SwapForm />}
          </div>
          <div
            className={cn(
              "inset-0 backdrop-blur-lg fixed z-40 transition-all duration-300",
              confirmView
                ? "bg-black/50 pointer-events-auto opacity-100"
                : "pointer-events-none bg-transparent opacity-0",
            )}
          />
          <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
        </div>
      </div>
    </>
  );
}
