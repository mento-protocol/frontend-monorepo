import { IconLoading } from "@mento-protocol/ui";

const row: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
};

// IconLoading's rects (two mid-gray, one white) are designed for a dark
// surface (e.g. inside a loading Button), so render it on one here.
const darkChip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  borderRadius: 8,
  backgroundColor: "#171717",
};

export const Default = () => (
  <div style={row}>
    <div style={darkChip}>
      <IconLoading style={{ width: 48, height: 48 }} />
    </div>
    <div style={darkChip}>
      <IconLoading style={{ width: 64, height: 64 }} />
    </div>
  </div>
);
