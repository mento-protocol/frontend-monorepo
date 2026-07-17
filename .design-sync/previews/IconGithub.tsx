import { IconGithub } from "@mento-protocol/ui";

const row: React.CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
};

export const Default = () => (
  <div style={row}>
    <IconGithub width={32} height={32} />
    <IconGithub width={40} height={40} />
  </div>
);

export const Brand = () => (
  <div style={row}>
    <IconGithub width={32} height={32} color="var(--primary)" />
  </div>
);
