import { Tabs, TabsList, TabsTrigger, TabsContent } from "@mento-protocol/ui";

export const SwapTabs = () => (
  <div style={{ width: 380 }}>
    <Tabs defaultValue="swap">
      <TabsList>
        <TabsTrigger value="swap">Swap</TabsTrigger>
        <TabsTrigger value="lock">Lock</TabsTrigger>
        <TabsTrigger value="governance">Governance</TabsTrigger>
      </TabsList>
      <TabsContent value="swap" className="pt-4">
        <p className="text-sm text-muted-foreground">
          Swap CELO for USDm at the current on-chain rate.
        </p>
      </TabsContent>
      <TabsContent value="lock" className="pt-4">
        <p className="text-sm text-muted-foreground">
          Lock MENTO to earn voting power and veMENTO.
        </p>
      </TabsContent>
      <TabsContent value="governance" className="pt-4">
        <p className="text-sm text-muted-foreground">
          Vote on active proposals from the Mento community.
        </p>
      </TabsContent>
    </Tabs>
  </div>
);

export const GovernanceTabActive = () => (
  <div style={{ width: 380 }}>
    <Tabs defaultValue="governance">
      <TabsList>
        <TabsTrigger value="swap">Swap</TabsTrigger>
        <TabsTrigger value="lock">Lock</TabsTrigger>
        <TabsTrigger value="governance">Governance</TabsTrigger>
      </TabsList>
      <TabsContent value="swap" className="pt-4">
        <p className="text-sm text-muted-foreground">
          Swap CELO for USDm at the current on-chain rate.
        </p>
      </TabsContent>
      <TabsContent value="lock" className="pt-4">
        <p className="text-sm text-muted-foreground">
          Lock MENTO to earn voting power and veMENTO.
        </p>
      </TabsContent>
      <TabsContent value="governance" className="pt-4">
        <p className="text-sm text-muted-foreground">
          Vote on active proposals from the Mento community.
        </p>
      </TabsContent>
    </Tabs>
  </div>
);
