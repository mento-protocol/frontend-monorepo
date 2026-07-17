import { IconInfo } from "@mento-protocol/ui";

const row: React.CSSProperties = {
  display: "flex",
  gap: 24,
  alignItems: "center",
};

export const Default = () => (
  <div style={row}>
    <div style={{ display: "inline-flex", transform: "scale(2.5)" }}>
      <IconInfo />
    </div>
  </div>
);
