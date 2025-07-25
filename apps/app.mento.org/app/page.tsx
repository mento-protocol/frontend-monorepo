"use client";

import { useAtom } from "jotai";
import { ArrowLeft } from "lucide-react";
import { SlippageDialog } from "./components/swap/slippage-dialog";
import { SwapConfirm } from "./components/swap/swap-confirm";
import SwapForm from "./components/swap/swap-form";
import { confirmViewAtom } from "@repo/web3";

import { Button, cn, IconCheck, Toaster } from "@repo/ui";

export default function SwapPage() {
  const [confirmView, setConfirmView] = useAtom(confirmViewAtom);

  return (
    <>
      <div className="flex h-full w-full flex-wrap items-center justify-center">
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
        <div className="relative mb-6 w-full max-w-[568px]">
          <div className="top-decorations before:bg-primary after:bg-card after:-top-15 hidden before:absolute before:-left-5 before:-top-5 before:block before:h-5 before:w-5 after:absolute after:left-0 after:block after:h-10 after:w-10 md:block"></div>
          <div
            className={cn(
              "bg-card relative z-50 flex flex-col space-y-6 p-6 md:h-[510px]",
              confirmView ? "h-[calc(100vh-160px)]" : "h-[510px]",
            )}
          >
            <div className="flex flex-row items-center justify-between gap-6">
              <h2 className="flex items-center gap-2 font-medium md:text-2xl">
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
              "fixed inset-0 z-40 backdrop-blur-lg transition-all duration-300",
              confirmView
                ? "pointer-events-auto bg-black/50 opacity-100"
                : "pointer-events-none bg-transparent opacity-0",
            )}
          />
          <div className="bottom-decorations before:bg-card after:bg-card after:-bottom-15 hidden before:absolute before:-bottom-5 before:-right-5 before:block before:h-5 before:w-5 before:invert after:absolute after:right-0 after:block after:h-10 after:w-10 md:block"></div>
        </div>
      </div>
    </>
  );
}
