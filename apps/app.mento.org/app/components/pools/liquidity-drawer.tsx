import { Sheet, SheetContent } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { LiquidityDrawerHeader } from "./liquidity-drawer-header";
import { LiquidityDrawerTabs } from "./liquidity-drawer-tabs";

interface LiquidityDrawerProps {
  pool: PoolDisplay;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "deposit" | "manage";
  hasLPTokens: boolean;
}

export function LiquidityDrawer({
  pool,
  isOpen,
  onOpenChange,
  mode,
  hasLPTokens,
}: LiquidityDrawerProps) {
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="sm:max-w-lg">
        <LiquidityDrawerHeader pool={pool} />
        <LiquidityDrawerTabs mode={mode} hasLPTokens={hasLPTokens} />
      </SheetContent>
    </Sheet>
  );
}
