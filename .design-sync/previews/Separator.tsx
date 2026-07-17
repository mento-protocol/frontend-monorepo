import { Separator } from "@mento-protocol/ui";

export const HorizontalDivider = () => (
  <div
    style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}
  >
    <span className="text-sm text-muted-foreground">Swap CELO for USDm</span>
    <Separator />
    <span className="text-sm text-muted-foreground">
      Estimated gas: 0.002 CELO
    </span>
  </div>
);

export const VerticalDivider = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, height: 24 }}>
    <span className="text-sm">CELO</span>
    <Separator orientation="vertical" />
    <span className="text-sm">USDm</span>
  </div>
);
