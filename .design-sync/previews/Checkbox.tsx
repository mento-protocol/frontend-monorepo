import { Checkbox, Label } from "@mento-protocol/ui";

export const UncheckedCheckbox = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <Checkbox id="checkbox-unchecked" />
    <Label htmlFor="checkbox-unchecked">I agree to the terms</Label>
  </div>
);

export const CheckedCheckbox = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <Checkbox id="checkbox-checked" defaultChecked />
    <Label htmlFor="checkbox-checked">Subscribe to governance updates</Label>
  </div>
);

export const DisabledCheckbox = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <Checkbox id="checkbox-disabled" disabled />
    <Label htmlFor="checkbox-disabled">Locked MENTO (unavailable)</Label>
  </div>
);
