import { Textarea } from "@mento-protocol/ui";

export const EmptyTextarea = () => (
  <Textarea placeholder="Describe your proposal..." style={{ width: 320 }} />
);

export const FilledTextarea = () => (
  <Textarea
    defaultValue="Increase the CELO reserve collateralization ratio from 2.0x to 2.2x to strengthen the Mento stability mechanism."
    style={{ width: 320 }}
  />
);

export const DisabledTextarea = () => (
  <Textarea
    defaultValue="Voting has closed for this proposal."
    disabled
    style={{ width: 320 }}
  />
);
