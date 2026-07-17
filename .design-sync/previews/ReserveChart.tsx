import { ReserveChart } from "@mento-protocol/ui";

// Preview-only: ReserveChart gates its recharts pie animation on
// `prefers-reduced-motion`. In a static screenshot the capture otherwise catches
// an early (collapsed) animation frame instead of the finished donut. Forcing the
// reduced-motion match here makes recharts paint the final frame immediately.
// This lives in the preview module, NOT the shipped bundle — real users keep the
// animation.
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

export const ReserveComposition = () => (
  <div style={{ width: 240, height: 240 }}>
    <ReserveChart
      centerText="Reserve"
      data={[
        { name: "USDC", value: 40, color: "#6a34ff" },
        { name: "CELO", value: 30, color: "#f59e0b" },
        { name: "ETH", value: 18, color: "#10b981" },
        { name: "BTC", value: 12, color: "#3b82f6" },
      ]}
    />
  </div>
);
