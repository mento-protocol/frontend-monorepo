import {
  CoinSelect,
  CoinSelectTrigger,
  CoinSelectValue,
  CoinSelectContent,
  CoinSelectItem,
} from "@mento-protocol/ui";

export const OpenTokenSelect = () => (
  <CoinSelect defaultValue="CELO" defaultOpen>
    <CoinSelectTrigger>
      <CoinSelectValue />
    </CoinSelectTrigger>
    <CoinSelectContent>
      <CoinSelectItem value="CELO">CELO</CoinSelectItem>
      <CoinSelectItem value="USDm">USDm</CoinSelectItem>
      <CoinSelectItem value="EURm">EURm</CoinSelectItem>
      <CoinSelectItem value="cUSD">cUSD</CoinSelectItem>
    </CoinSelectContent>
  </CoinSelect>
);
