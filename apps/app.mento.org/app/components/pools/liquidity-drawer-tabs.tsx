import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { useState, useEffect } from "react";
import { AddLiquidityForm } from "./add-liquidity-form";
import { RemoveLiquidityForm } from "./remove-liquidity-form";

interface LiquidityDrawerTabsProps {
  mode: "deposit" | "manage";
  hasLPTokens: boolean;
  pool: PoolDisplay;
}

export function LiquidityDrawerTabs({
  mode,
  hasLPTokens,
  pool,
}: LiquidityDrawerTabsProps) {
  const [activeTab, setActiveTab] = useState(
    mode === "deposit" ? "add" : "remove",
  );
  const isRemoveDisabled = !hasLPTokens;
  const showRemoveTooltip = isRemoveDisabled;

  useEffect(() => {
    if (!hasLPTokens && activeTab === "remove") {
      setActiveTab("add");
    }
  }, [hasLPTokens, activeTab]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="min-h-0 flex flex-1 flex-col"
    >
      <TabsList className="px-6 gap-x-20 w-full justify-center">
        <TabsTrigger value="add">Add Liquidity</TabsTrigger>
        {showRemoveTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <TabsTrigger
                  value="remove"
                  disabled
                  className="pointer-events-none"
                >
                  Remove Liquidity
                </TabsTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-60">
              Available only when you have added liquidity
            </TooltipContent>
          </Tooltip>
        ) : (
          <TabsTrigger value="remove">Remove Liquidity</TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="add" className="min-h-0 flex flex-1 flex-col">
        <AddLiquidityForm pool={pool} />
      </TabsContent>
      <TabsContent value="remove" className="min-h-0 flex flex-1 flex-col">
        <RemoveLiquidityForm pool={pool} />
      </TabsContent>
    </Tabs>
  );
}
