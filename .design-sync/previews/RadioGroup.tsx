import { RadioGroup, RadioGroupItem, Label } from "@mento-protocol/ui";

export const RadioGroupOptions = () => (
  <RadioGroup defaultValue="approve">
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <RadioGroupItem value="approve" id="vote-approve" />
      <Label htmlFor="vote-approve">Approve</Label>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <RadioGroupItem value="reject" id="vote-reject" />
      <Label htmlFor="vote-reject">Reject</Label>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <RadioGroupItem value="abstain" id="vote-abstain" />
      <Label htmlFor="vote-abstain">Abstain</Label>
    </div>
  </RadioGroup>
);

export const RadioGroupDisabled = () => (
  <RadioGroup defaultValue="approve" disabled>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <RadioGroupItem value="approve" id="vote-approve-disabled" />
      <Label htmlFor="vote-approve-disabled">Approve</Label>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <RadioGroupItem value="reject" id="vote-reject-disabled" />
      <Label htmlFor="vote-reject-disabled">Reject</Label>
    </div>
  </RadioGroup>
);
