import {
  CoinCard,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardSymbol,
  CoinCardName,
  CoinCardLogo,
  CoinCardFooter,
  CoinCardSupply,
  TokenIcon,
} from "@mento-protocol/ui";

const logo = (symbol: string, name: string) => (
  <CoinCardLogo>
    <TokenIcon
      token={{ address: "0x0", symbol, name, decimals: 18 }}
      size={32}
    />
  </CoinCardLogo>
);

export const StablecoinCard = () => (
  <div style={{ maxWidth: 320 }}>
    <CoinCard className="h-fit">
      <CoinCardHeader className="justify-between">
        <CoinCardHeaderGroup>
          <CoinCardSymbol>USDm</CoinCardSymbol>
          <CoinCardName>Mento Dollar</CoinCardName>
        </CoinCardHeaderGroup>
        {logo("USDm", "Mento Dollar")}
      </CoinCardHeader>
      <CoinCardFooter>
        <CoinCardSupply>$16,904,872.81</CoinCardSupply>
      </CoinCardFooter>
    </CoinCard>
  </div>
);

export const EuroStablecoin = () => (
  <div style={{ maxWidth: 320 }}>
    <CoinCard className="h-fit">
      <CoinCardHeader className="justify-between">
        <CoinCardHeaderGroup>
          <CoinCardSymbol>EURm</CoinCardSymbol>
          <CoinCardName>Mento Euro</CoinCardName>
        </CoinCardHeaderGroup>
        {logo("EURm", "Mento Euro")}
      </CoinCardHeader>
      <CoinCardFooter>
        <CoinCardSupply>€8,240,155.02</CoinCardSupply>
      </CoinCardFooter>
    </CoinCard>
  </div>
);
