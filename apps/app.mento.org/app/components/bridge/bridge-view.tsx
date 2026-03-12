"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import { getBridgeTheme, bridgeConfig } from "./bridge-config";

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

export function BridgeView() {
  const { resolvedTheme } = useTheme();
  const theme = useMemo(
    () => getBridgeTheme(resolvedTheme === "dark" ? "dark" : "light"),
    [resolvedTheme],
  );

  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 pb-16 relative min-h-[550px] w-full">
      {/* Header */}
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="p-6 flex items-center justify-between bg-card">
          <div>
            <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
              Cross-Chain
            </span>
            <h1 className="mt-2 font-bold text-3xl">Bridge</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bridge Mento tokens between supported networks.
            </p>
          </div>
        </div>
      </div>

      {/* Wormhole Connect Widget */}
      <div className="relative overflow-hidden">
        <WormholeConnect theme={theme} config={bridgeConfig} />
      </div>

      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
    </div>
  );
}
