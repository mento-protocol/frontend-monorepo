"use client";

import type { ReactNode } from "react";
import {
  ChainId,
  getDebtTokenConfig,
  getMainnetFallbackChainId,
  isFeatureSupported,
  isTestnetChain,
  type DebtTokenConfig,
  useTestnetMode,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { FlowDialog } from "./shared/flow-dialog";
import { UnsupportedChainState } from "./shared/unsupported-chain-state";
import { HiddenTestnetState } from "@/components/shared/hidden-testnet-state";

interface BorrowViewProps {
  children: ReactNode;
  showHeader?: boolean;
  unsupportedDebtToken?: DebtTokenConfig;
}

export function BorrowView({
  children,
  showHeader = false,
  unsupportedDebtToken = getDebtTokenConfig("GBPm"),
}: BorrowViewProps) {
  const chainId = useChainId();
  const [testnetMode] = useTestnetMode();

  const isHiddenTestnet = isTestnetChain(chainId) && !testnetMode;
  const isBorrowChainSupported = isFeatureSupported({
    chainId,
    feature: "borrow",
    testnetMode,
  });
  const fallbackChainId = getMainnetFallbackChainId(chainId) ?? ChainId.Celo;

  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 pb-16 md:px-0 md:pt-0 min-h-[550px] w-full">
      {showHeader && (
        <div className="relative">
          <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
          <div className="p-6 flex items-start justify-between bg-card">
            <div>
              <span className="font-mono font-medium tracking-widest text-[11px] text-muted-foreground uppercase">
                Collateralized Debt
              </span>
              <h1 className="mt-2 font-bold text-3xl">Borrow</h1>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
                Borrow stablecoins against your collateral.
              </p>
            </div>
          </div>
        </div>
      )}

      {isHiddenTestnet ? (
        <HiddenTestnetState
          title="Testnet hidden"
          description="Borrow on Celo Sepolia is available when Testnet Mode is enabled. Enable it from the profile menu, or switch back to Celo mainnet."
          switchChainId={fallbackChainId}
        />
      ) : !isBorrowChainSupported ? (
        <UnsupportedChainState
          feature="borrow"
          debtToken={unsupportedDebtToken}
        />
      ) : (
        <>
          {children}
          <FlowDialog />
        </>
      )}
    </div>
  );
}
