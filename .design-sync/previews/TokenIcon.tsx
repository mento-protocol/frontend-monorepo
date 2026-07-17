import { TokenIcon } from "@mento-protocol/ui";

const token = (symbol: string, name: string) => ({
  address: "0x0000000000000000000000000000000000000000",
  symbol,
  name,
  decimals: 18,
});

export const StablecoinIcons = () => (
  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
    <TokenIcon token={token("CELO", "Celo")} size={40} />
    <TokenIcon token={token("USDm", "Mento Dollar")} size={40} />
    <TokenIcon token={token("EURm", "Mento Euro")} size={40} />
  </div>
);

export const TokenIconLarge = () => (
  <TokenIcon token={token("cUSD", "Celo Dollar")} size={64} />
);
