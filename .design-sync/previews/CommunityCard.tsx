import { CommunityCard } from "@mento-protocol/ui";

export const DefaultCommunityCard = () => <CommunityCard />;

export const GovernanceForumCard = () => (
  <CommunityCard
    title="Join the governance forum"
    description="Discuss Mento Improvement Proposals, share feedback, and help shape the protocol's future with the community."
    buttonText="Visit the forum"
    buttonHref="https://forum.mento.org"
  />
);
