"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useMemo } from "react";
import { getBridgeTheme, bridgeConfig } from "./bridge-config";
import { Button } from "@repo/ui";
import { Celo, ChainId } from "@repo/web3";
import { useChainId, useSwitchChain } from "@repo/web3/wagmi";
import { ArrowRightLeft } from "lucide-react";

const TESTNET_CHAIN_IDS = new Set<number>([
  ChainId.CeloSepolia,
  ChainId.MonadTestnet,
]);

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
  const { switchChainAsync } = useSwitchChain();

  const handleSwitch = async () => {
    try {
      await switchChainAsync({ chainId: Celo.id });
    } catch {
      // wallet rejected or doesn't support switching
    }
  };

  return (
    <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
      <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      <div className="mb-7 flex justify-center">
        <div className="h-14 w-14 flex items-center justify-center rounded-full border-2 border-border bg-card">
          <ArrowRightLeft className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>

      <h2 className="mb-2.5 text-xl font-bold tracking-tight">
        Bridging is not available on testnets
      </h2>
      <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
        Switch to a mainnet network to bridge Mento stablecoins between
        supported networks.
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
  const isTestnet = TESTNET_CHAIN_IDS.has(chainId);
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
              Bridge Mento stablecoins between supported networks.
            </p>
          </div>
        </div>
      </div>

      {/* Wormhole Connect Widget or Testnet State */}
      {isTestnet ? (
        <BridgeTestnetState />
      ) : (
        <div className="relative overflow-hidden">
          <WormholeConnect theme={theme} config={bridgeConfig} />
        </div>
      )}

      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
    </div>
  );
}
