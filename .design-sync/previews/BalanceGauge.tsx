import { BalanceGauge } from "@mento-protocol/ui";

export const ReserveSplit = () => (
  <div style={{ padding: 12 }}>
    <BalanceGauge
      token0Percent={33.3}
      token1Percent={66.7}
      token0Reserves="333K"
      token1Reserves="667K"
      token0Symbol="GBPm"
      token1Symbol="USDm"
      exchangeRate="1.33"
      inputSymbol="GBPm"
      outputSymbol="USDm"
    />
  </div>
);

export const EvenSplit = () => (
  <div style={{ padding: 12 }}>
    <BalanceGauge
      token0Percent={50}
      token1Percent={50}
      token0Reserves="1.2M"
      token1Reserves="1.2M"
      token0Symbol="CELO"
      token1Symbol="USDm"
      exchangeRate="0.64"
      inputSymbol="CELO"
      outputSymbol="USDm"
    />
  </div>
);
