import { ProposalStatus } from "@mento-protocol/ui";

export const ActiveStates = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <ProposalStatus variant="active">Active</ProposalStatus>
    <ProposalStatus variant="pending">Pending</ProposalStatus>
    <ProposalStatus variant="queued">Queued</ProposalStatus>
  </div>
);

export const ResolvedStates = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <ProposalStatus variant="succeeded">Succeeded</ProposalStatus>
    <ProposalStatus variant="defeated">Defeated</ProposalStatus>
    <ProposalStatus variant="executed">Executed</ProposalStatus>
    <ProposalStatus variant="canceled">Canceled</ProposalStatus>
  </div>
);
