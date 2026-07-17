import { Label, Input } from "@mento-protocol/ui";

export const LabeledInput = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 260 }}>
    <Label htmlFor="label-input-demo">Amount to swap</Label>
    <Input id="label-input-demo" placeholder="0.0" />
  </div>
);

export const BareLabel = () => <Label>Recipient address</Label>;
