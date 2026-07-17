import { BalanceGauge } from "@mento-protocol/ui";

// Preview-only: BalanceGauge (like ReserveChart) gates its recharts pie animation
// on `prefers-reduced-motion`. In a static screenshot the capture can otherwise
// catch a mid-animation frame and flake on re-sync grading. Force the reduced-motion
// match here so recharts paints the final frame immediately. Preview module only —
// never enters the shipped bundle, so real users keep the animation.
if (typeof window !== "undefined" && window.matchMedia) {
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) =>
    /prefers-reduced-motion/.test(query)
      ? {
          matches: true,
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent() {
            return false;
          },
        }
      : original(query)) as typeof window.matchMedia;
}

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
