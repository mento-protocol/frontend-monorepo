"use client";

import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import { ArrowLeft } from "lucide-react";
import { SwapSettingsPopover } from "@/components/swap/swap-settings-popover";
import { SwapConfirm } from "@/components/swap/swap-confirm";
import SwapForm from "@/components/swap/swap-form";
import { confirmViewAtom, formValuesAtom, type ChainId } from "@repo/web3";
import { Button, cn } from "@repo/ui";
import { ChainMismatchBanner } from "@/components/shared/chain-mismatch-banner";

interface SwapPageContentProps {
  chainId: ChainId;
  initialFrom?: string;
  initialTo?: string;
  initialAmount?: string;
}

export function SwapPageContent({
  chainId,
  initialFrom,
  initialTo,
  initialAmount,
}: SwapPageContentProps) {
  const [confirmView, setConfirmView] = useAtom(confirmViewAtom);
  const [formValues] = useAtom(formValuesAtom);
  const previousChainIdRef = useRef(chainId);
  const confirmViewRef = useRef(confirmView);
  const formValuesRef = useRef(formValues);

  useEffect(() => {
    confirmViewRef.current = confirmView;
  }, [confirmView]);

  useEffect(() => {
    formValuesRef.current = formValues;
  }, [formValues]);

  useEffect(() => {
    const previousChainId = previousChainIdRef.current;
    previousChainIdRef.current = chainId;

    if (previousChainId !== chainId) {
      setConfirmView(false);
      return;
    }

    if (!confirmViewRef.current || !formValuesRef.current) return;

    const routeTokenIn = initialFrom || "";
    const routeTokenOut = initialTo || "";
    const routeAmount = initialAmount || "";
    const confirmTokenIn = formValuesRef.current.tokenInSymbol || "";
    const confirmTokenOut = formValuesRef.current.tokenOutSymbol || "";
    const confirmAmount = formValuesRef.current.amount || "";

    const routeDiffersFromConfirmState =
      routeTokenIn !== confirmTokenIn ||
      routeTokenOut !== confirmTokenOut ||
      routeAmount !== confirmAmount;

    if (routeDiffersFromConfirmState) {
      setConfirmView(false);
    }
  }, [chainId, initialAmount, initialFrom, initialTo, setConfirmView]);

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <div className="mb-6 px-4 md:px-0 relative w-full max-w-[568px]">
        <ChainMismatchBanner targetChainId={chainId} />
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div
          className={cn(
            "space-y-6 p-6 md:min-h-[525px] relative z-50 flex flex-col bg-card",
            confirmView ? "md:min-h-[525px] h-auto" : "min-h-[525px]",
          )}
        >
          <div className="gap-6 flex flex-row items-center justify-between">
            <div>
              {!confirmView && (
                <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
                  Token Exchange
                </span>
              )}
              <h2 className="mt-0 gap-2 font-bold flex items-center text-3xl">
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
              {!confirmView && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Trade between Mento stablecoins and other tokens.
                </p>
              )}
            </div>
            {!confirmView && <SwapSettingsPopover />}
          </div>
          {confirmView && <SwapConfirm />}
          {/*
           * Keep SwapForm always mounted; only toggle visibility with `hidden`.
           * Using `display: contents` (or conditional rendering) here caused a
           * DOM removeChild crash when navigating between [chain] routes while
           * confirm view was active, because React tried to remove a node that
           * the browser had already detached during the route transition.
           */}
          <div className={cn("flex flex-1 flex-col", confirmView && "hidden")}>
            <SwapForm
              initialFrom={initialFrom}
              initialTo={initialTo}
              initialAmount={initialAmount}
              targetChainId={chainId}
            />
          </div>
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
  );
}
