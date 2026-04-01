"use client";

import { Button, TokenIcon } from "@repo/ui";
import { Celo } from "@repo/web3";
import { useSwitchChain } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { ArrowRightLeft } from "lucide-react";

export function UnsupportedChainState({
  feature,
}: {
  feature: "borrow" | "earn";
}) {
  const { switchChainAsync } = useSwitchChain();
  const targetChain = Celo;

  const collateralAddress = (() => {
    try {
      return getTokenAddress(
        targetChain.id,
        "USDm" as TokenSymbol,
      ) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

  const debtTokenAddress = (() => {
    try {
      return getTokenAddress(
        targetChain.id,
        "GBPm" as TokenSymbol,
      ) as `0x${string}`;
    } catch {
      return undefined;
    }
  })();

  const handleSwitch = async () => {
    try {
      await switchChainAsync({ chainId: targetChain.id });
    } catch {
      // wallet rejected or doesn't support switching
    }
  };

  const title =
    feature === "borrow"
      ? `Borrowing is only available on Celo networks`
      : `Stability Pool earning is only available on Celo networks`;

  const description =
    feature === "borrow"
      ? `Switch to ${targetChain.name} to open Troves, deposit collateral, and borrow stablecoins.`
      : `Switch to ${targetChain.name} to deposit into the Stability Pool and earn rewards.`;

  return (
    <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
      {/* Top accent line */}
      <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      {/* Token icon cluster */}
      <div className="mb-7 flex justify-center">
        <div className="h-14 w-20 relative">
          <div className="left-0 top-2 absolute z-[2]">
            {collateralAddress ? (
              <TokenIcon
                token={{ address: collateralAddress, symbol: "USDm" }}
                size={44}
                className="rounded-full"
              />
            ) : (
              <div className="h-11 w-11 bg-emerald-500 text-lg font-bold flex items-center justify-center rounded-full">
                $
              </div>
            )}
          </div>
          <div className="left-8 top-2 absolute z-[1]">
            <div className="rounded-full border-[3px] border-card">
              {debtTokenAddress ? (
                <TokenIcon
                  token={{ address: debtTokenAddress, symbol: "GBPm" }}
                  size={44}
                  className="rounded-full"
                />
              ) : (
                <div className="h-11 w-11 bg-indigo-500 text-lg font-bold flex items-center justify-center rounded-full">
                  £
                </div>
              )}
            </div>
          </div>
          {/* Arrow badge */}
          <div className="left-6 top-0 absolute z-[3] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-border bg-card">
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="text-primary"
            >
              <path
                d="M3 5h4M5.5 3L7 5l-1.5 2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>

      <h2 className="mb-2.5 text-xl font-bold tracking-tight">{title}</h2>
      <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
        {description}
      </p>

      {/* CTA */}
      <Button onClick={handleSwitch} size="lg" className="gap-2.5">
        <ArrowRightLeft className="h-4 w-4" />
        Switch to {targetChain.name}
      </Button>
    </div>
  );
}
