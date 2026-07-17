import { CoinInput } from "@mento-protocol/ui";

export const CoinInputDefault = () => (
  <CoinInput defaultValue="123.456" style={{ width: 200 }} />
);

export const CoinInputDisabled = () => (
  <CoinInput defaultValue="500" disabled style={{ width: 200 }} />
);
