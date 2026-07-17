import { Button } from "@mento-protocol/ui";

const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};

export const Variants = () => (
  <div style={row}>
    <Button clipped="default">Default</Button>
    <Button variant="secondary" clipped="default">
      Secondary
    </Button>
    <Button variant="outline" clipped="default">
      Outline
    </Button>
    <Button variant="ghost" clipped="default">
      Ghost
    </Button>
    <Button variant="link">Link</Button>
    <Button variant="destructive" clipped="default">
      Destructive
    </Button>
  </div>
);

export const GovernanceVotes = () => (
  <div style={row}>
    <Button variant="approve" clipped="default">
      Approve
    </Button>
    <Button variant="abstain" clipped="default">
      Abstain
    </Button>
    <Button variant="reject" clipped="default">
      Reject
    </Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button size="xs">XS</Button>
    <Button size="sm" clipped="sm">
      Small
    </Button>
    <Button size="md" clipped="default">
      Medium
    </Button>
    <Button size="lg" clipped="lg">
      Large
    </Button>
  </div>
);

export const States = () => (
  <div style={row}>
    <Button clipped="default">Enabled</Button>
    <Button disabled clipped="default">
      Disabled
    </Button>
  </div>
);
