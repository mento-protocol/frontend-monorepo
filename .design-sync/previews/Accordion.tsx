import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@mento-protocol/ui";

export const SingleCollapsible = () => (
  <div style={{ width: 380 }}>
    <Accordion type="single" collapsible defaultValue="item-1">
      <AccordionItem value="item-1">
        <AccordionTrigger>What is Mento?</AccordionTrigger>
        <AccordionContent>
          Mento is a decentralized protocol for creating stablecoins backed by
          an on-chain reserve on Celo.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>How are reserves managed?</AccordionTrigger>
        <AccordionContent>
          A diversified basket of crypto assets backs every Mento stablecoin,
          held transparently on-chain.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Which stablecoins are supported?</AccordionTrigger>
        <AccordionContent>
          Mento powers a growing family of local-currency stablecoins including
          cUSD, cEUR, and cREAL.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>
);
