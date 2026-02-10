import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { PoolDisplay } from "@repo/web3";
import { AddLiquidityForm } from "./add-liquidity-form";

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
  const defaultTab = mode === "deposit" ? "add" : "remove";

  return (
    <Tabs defaultValue={defaultTab} className="min-h-0 flex flex-1 flex-col">
      <TabsList className="px-6 w-full">
        <TabsTrigger value="add">Add liquidity</TabsTrigger>
        <TabsTrigger
          value="remove"
          disabled={mode === "deposit" || !hasLPTokens}
        >
          Remove liquidity
        </TabsTrigger>
      </TabsList>
      <TabsContent value="add" className="min-h-0 flex flex-1 flex-col">
        <AddLiquidityForm pool={pool} />
      </TabsContent>
      <TabsContent value="remove" className="min-h-0 flex flex-1 flex-col">
        <div className="p-6 flex items-center justify-center text-center text-muted-foreground">
          Coming soon
        </div>
      </TabsContent>
    </Tabs>
  );
}
