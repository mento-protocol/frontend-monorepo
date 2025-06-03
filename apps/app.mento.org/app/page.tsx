"use client";

import { Button } from "@repo/ui";
import { useAtom } from "jotai";
import { ArrowLeft } from "lucide-react";
import { SlippageDialog } from "./components/swap/slippage-dialog";
import { SwapConfirm } from "./components/swap/swap-confirm";
import SwapForm from "./components/swap/swap-form";
import { confirmViewAtom } from "./features/swap/swap-atoms";

import { IconCheck, Toaster } from "@repo/ui";

export default function SwapPage() {
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
      <div className="relative mb-6 w-full max-w-[568px]">
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
            <SlippageDialog />
          </div>
          {confirmView ? <SwapConfirm /> : <SwapForm />}
        </div>
        <div className="bottom-decorations before:bg-card after:bg-card after:-bottom-15 before:absolute before:-bottom-5 before:-right-5 before:block before:h-5 before:w-5 before:invert after:absolute after:right-0 after:block after:h-10 after:w-10"></div>
      </div>
    </div>
  );
}
