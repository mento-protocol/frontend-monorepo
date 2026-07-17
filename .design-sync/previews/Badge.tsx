import { Badge } from "@mento-protocol/ui";

export const BadgeVariants = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <Badge>Default</Badge>
    <Badge variant="secondary">Secondary</Badge>
    <Badge variant="outline">Outline</Badge>
    <Badge variant="destructive">Destructive</Badge>
  </div>
);

export const ProposalStatusBadges = () => (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <Badge>Active</Badge>
    <Badge variant="secondary">Pending</Badge>
    <Badge variant="outline">Executed</Badge>
    <Badge variant="destructive">Failed</Badge>
  </div>
);
