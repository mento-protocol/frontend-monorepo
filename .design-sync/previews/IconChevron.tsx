import { IconChevron } from "@mento-protocol/ui";

const row: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
};

export const Default = () => (
  <div style={row}>
    <IconChevron style={{ width: 32, height: 32 }} fill="#171717" />
    <IconChevron style={{ width: 40, height: 40 }} fill="#171717" />
  </div>
);

export const Brand = () => (
  <div style={row}>
    <IconChevron style={{ width: 32, height: 32 }} fill="var(--primary)" />
  </div>
);
