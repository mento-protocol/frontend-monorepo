import { IconCheck } from "@mento-protocol/ui";

const row: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
};

export const Default = () => (
  <div style={row}>
    <IconCheck style={{ width: 32, height: 32 }} />
    <IconCheck style={{ width: 40, height: 40 }} />
  </div>
);

export const Brand = () => (
  <div style={row}>
    <IconCheck style={{ width: 32, height: 32 }} fill="var(--primary)" />
  </div>
);
