import { IconMento } from "@mento-protocol/ui";

const row: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
};

export const Default = () => (
  <div style={row}>
    <IconMento width={32} height={32} />
    <IconMento width={60} height={60} />
  </div>
);
