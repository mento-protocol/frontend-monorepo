import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Button,
} from "@mento-protocol/ui";

export const OpenFAQ = () => (
  <div style={{ width: 380 }}>
    <Collapsible defaultOpen>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          What backs Mento stablecoins?
          <span className="text-xs">Hide</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 rounded p-4 border">
        <p>
          Every Mento stablecoin is backed by a diversified, on-chain reserve of
          crypto assets held transparently and verifiable by anyone.
        </p>
      </CollapsibleContent>
    </Collapsible>
  </div>
);

export const ClosedFAQ = () => (
  <div style={{ width: 380 }}>
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          How is the reserve managed?
          <span className="text-xs">Show</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 rounded p-4 border">
        <p>
          The Reserve is managed by governance-approved policies and audited
          on-chain.
        </p>
      </CollapsibleContent>
    </Collapsible>
  </div>
);
