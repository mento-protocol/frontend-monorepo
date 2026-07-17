import { CopyToClipboard } from "@mento-protocol/ui";

export const CopyWalletAddress = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span className="text-sm text-muted-foreground">0x1a2b...9f3c</span>
    <CopyToClipboard
      text="0x1a2b3c4d5e6f7890abcdef1234567890abcdef9f3c"
      ariaLabel="Copy wallet address"
    />
  </div>
);

export const CopyTransactionHash = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span className="text-sm text-muted-foreground">0x7f9e...4b21</span>
    <CopyToClipboard
      text="0x7f9e8d7c6b5a4938271605f4e3d2c1b0a9887654b21"
      toastMsg="Transaction hash copied"
      ariaLabel="Copy transaction hash"
    />
  </div>
);
