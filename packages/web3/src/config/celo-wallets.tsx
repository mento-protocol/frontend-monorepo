import { tryClipboardSet } from "@/utils/clipboard";
import type { Wallet } from "@rainbow-me/rainbowkit";
import { getWalletConnectConnector } from "@rainbow-me/rainbowkit";
import { toast } from "@repo/ui";

interface WalletOptions {
  projectId: string;
}

export const CeloWallet = ({ projectId }: WalletOptions): Wallet => ({
  id: "celo-wallet",
  name: "Celo Wallet",
  iconUrl: "./wallets/celo-wallet.svg",
  iconBackground: "#FFF",

  mobile: { getUri: (uri: string) => uri },
  desktop: {
    getUri: (uri: string) => {
      tryClipboardSet(uri);
      toast.success("WalletConnect URL copied to clipboard");
      return `celowallet://wc?uri=${encodeURIComponent(uri)}`;
    },
  },

  createConnector: getWalletConnectConnector({ projectId }),
});
