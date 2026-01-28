import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";

interface LiquidityDrawerTabsProps {
  mode: "deposit" | "manage";
  hasLPTokens: boolean;
}

export function LiquidityDrawerTabs({
  mode,
  hasLPTokens,
}: LiquidityDrawerTabsProps) {
  const defaultTab = mode === "deposit" ? "add" : "remove";

  return (
    <Tabs defaultValue={defaultTab} className="flex flex-1 flex-col">
      <TabsList className="w-full">
        <TabsTrigger value="add" className="flex-1">
          Add liquidity
        </TabsTrigger>
        <TabsTrigger
          value="remove"
          className="flex-1"
          disabled={mode === "deposit" || !hasLPTokens}
        >
          Remove liquidity
        </TabsTrigger>
      </TabsList>
      <TabsContent value="add" className="flex-1">
        <div className="p-6 flex items-center justify-center text-center text-muted-foreground">
          Coming soon
        </div>
      </TabsContent>
      <TabsContent value="remove" className="flex-1">
        <div className="p-6 flex items-center justify-center text-center text-muted-foreground">
          Coming soon
        </div>
      </TabsContent>
    </Tabs>
  );
}
