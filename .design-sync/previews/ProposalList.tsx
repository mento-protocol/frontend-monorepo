import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  ProposalList,
  ProposalListItem,
  ProposalListItemIndex,
  ProposalListItemBody,
} from "@mento-protocol/ui";

export const GovernanceProposalList = () => (
  <div style={{ maxWidth: 480 }}>
    <Card>
      <CardHeader>
        <CardTitle>Recent Proposals</CardTitle>
        <CardDescription>Mento Governance</CardDescription>
      </CardHeader>
      <CardContent>
        <ProposalList>
          <ProposalListItem>
            <ProposalListItemIndex index="42" />
            <ProposalListItemBody>
              Increase Reserve Diversification Threshold
            </ProposalListItemBody>
          </ProposalListItem>
          <ProposalListItem>
            <ProposalListItemIndex index="41" />
            <ProposalListItemBody>
              Add EURm to the Broker Exchange
            </ProposalListItemBody>
          </ProposalListItem>
          <ProposalListItem>
            <ProposalListItemIndex index="40" />
            <ProposalListItemBody>
              Adjust MENTO Emission Schedule
            </ProposalListItemBody>
          </ProposalListItem>
        </ProposalList>
      </CardContent>
    </Card>
  </div>
);
