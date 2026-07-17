import { Input } from "@mento-protocol/ui";

export const EmptyInput = () => (
  <Input placeholder="Enter amount..." style={{ width: 260 }} />
);

export const FilledInput = () => (
  <Input defaultValue="0x1a2B...9fE3" style={{ width: 260 }} />
);

export const DisabledInput = () => (
  <Input defaultValue="CELO" disabled style={{ width: 260 }} />
);
