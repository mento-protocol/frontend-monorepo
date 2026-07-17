import {
  ProposalCard,
  ProposalCardHeader,
  ProposalCardBody,
  ProposalCardFooter,
  ProposalStatus,
} from "@mento-protocol/ui";

// ProposalCardHeader is hard-coded to a dark surface in both `:root` and `.dark`
// (its `--dark-background`/`--another-card-color` tokens are identical), so the
// card is designed to live inside a dark app shell (governance/app default dark).
// Render it in a `.dark` context so header text uses the light foreground it was
// designed for — the faithful representation of this component.
const darkShell: React.CSSProperties = {
  background: "var(--background)",
  padding: 20,
  maxWidth: 520,
};

// Bare inherited `color` is computed at <body> (light theme) and passed down as a
// resolved value, so it doesn't re-evaluate inside the `.dark` wrapper. Set the
// title color explicitly so it resolves against the dark-scope --foreground.
const title: React.CSSProperties = {
  color: "var(--foreground)",
  fontWeight: 500,
};

export const ActiveProposal = () => (
  <div className="dark" style={darkShell}>
    <ProposalCard>
      <ProposalCardHeader>
        <span style={title}>
          MIP-42: Increase Reserve Diversification Threshold
        </span>
      </ProposalCardHeader>
      <ProposalCardBody>
        <p className="text-sm text-muted-foreground">
          Raise the maximum CELO allocation in the reserve basket from 40% to
          50% to reduce dependence on USDC.
        </p>
      </ProposalCardBody>
      <ProposalCardFooter>
        <ProposalStatus variant="active">Active</ProposalStatus>
      </ProposalCardFooter>
    </ProposalCard>
  </div>
);

export const HighlightedProposal = () => (
  <div className="dark" style={darkShell}>
    <ProposalCard>
      <ProposalCardHeader variant="highlighted">
        <span style={title}>MIP-38: Add EURm to the Broker Exchange</span>
      </ProposalCardHeader>
      <ProposalCardBody>
        <p className="text-sm text-muted-foreground">
          Onboard the Mento Euro stablecoin to the Broker with an initial
          liquidity pool against cEUR.
        </p>
      </ProposalCardBody>
      <ProposalCardFooter>
        <ProposalStatus variant="succeeded">Succeeded</ProposalStatus>
      </ProposalCardFooter>
    </ProposalCard>
  </div>
);
