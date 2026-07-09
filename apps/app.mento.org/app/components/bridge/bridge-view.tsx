"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { getBridgeTheme, bridgeConfig } from "./bridge-config";
import { Button } from "@repo/ui";
import {
  Celo,
  isFeatureConfiguredOnChain,
  useSwitchChainWithFeedback,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { ArrowRightLeft } from "lucide-react";
import { patchBridgeWidgetAccessibility } from "./bridge-widget-accessibility";

const WormholeConnect = dynamic(
  () => import("@wormhole-foundation/wormhole-connect"),
  {
    ssr: false,
    loading: () => (
      <div className="py-24 flex items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-primary/30" />
      </div>
    ),
  },
);

function BridgeTestnetState() {
  const { switchToChain } = useSwitchChainWithFeedback();

  const handleSwitch = async () => {
    await switchToChain(Celo.id);
  };

  return (
    <div className="px-6 py-14 relative overflow-hidden rounded-xl bg-card text-center">
      <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      <div className="mb-7 flex justify-center">
        <div className="gap-4 flex items-center">
          <div className="h-14 w-14 shadow-lg flex items-center justify-center rounded-full bg-[#FCFF52] shadow-[#FCFF52]/20">
            <Image
              src="/tokens/CELO.svg"
              alt="Celo"
              width={40}
              height={40}
              className="h-10 w-10"
            />
          </div>

          <div className="gap-1 flex flex-col items-center">
            <div className="w-16 h-[2px] bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            <div className="w-16 h-[2px] bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
          </div>

          <div className="h-14 w-14 shadow-lg flex items-center justify-center rounded-full shadow-[#836EF9]/20">
            <Image
              src="/networks/monad.svg"
              alt="Monad"
              width={56}
              height={56}
              className="h-14 w-14"
            />
          </div>
        </div>
      </div>

      <h2 className="mb-2.5 text-xl font-bold tracking-tight">
        Bridging is currently mainnet-only
      </h2>
      <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
        Switch to a supported mainnet network to bridge Mento stablecoins
        between Celo and Monad.
      </p>

      <Button onClick={handleSwitch} size="lg" className="gap-2.5">
        <ArrowRightLeft className="h-4 w-4" />
        Switch to Mainnet
      </Button>
    </div>
  );
}

export function BridgeView() {
  const chainId = useChainId();
  const widgetRef = useRef<HTMLDivElement>(null);
  const isBridgeSupportedChain =
    !chainId ||
    isFeatureConfiguredOnChain({
      chainId,
      feature: "bridge",
    });
  const { resolvedTheme } = useTheme();
  const theme = useMemo(
    () => getBridgeTheme(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  useEffect(() => {
    const root = widgetRef.current;
    if (!root || !isBridgeSupportedChain) return;

    patchBridgeWidgetAccessibility(root);

    const observer = new MutationObserver(() => {
      patchBridgeWidgetAccessibility(root);
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["aria-label"],
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [isBridgeSupportedChain]);

  return (
    <div className="mb-6 px-4 md:px-0 relative w-full max-w-[568px]">
      <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
      <div className="relative z-50 flex min-h-[525px] flex-col bg-card">
        <div className="px-6 pt-6 pb-2">
          <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
            Cross-Chain
          </span>
          <h1 className="mt-0 font-bold text-3xl">Bridge</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bridge Mento tokens between supported networks.
          </p>
        </div>
        {!isBridgeSupportedChain ? (
          <BridgeTestnetState />
        ) : (
          <div ref={widgetRef} className="bridge-widget">
            <WormholeConnect theme={theme} config={bridgeConfig} />
          </div>
        )}
      </div>
      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
    </div>
  );
}
