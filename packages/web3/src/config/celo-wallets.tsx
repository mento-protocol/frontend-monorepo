import { tryClipboardSet } from "@/utils/clipboard";
import type { Wallet } from "@rainbow-me/rainbowkit";
import { getWalletConnectConnector } from "@rainbow-me/rainbowkit";
import { omniWallet, trustWallet } from "@rainbow-me/rainbowkit/wallets";
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

export const TrustWallet = ({ projectId }: WalletOptions): Wallet => {
  const trustWalletConfig = trustWallet({ projectId });

  return {
    id: "trust",
    name: "Trust Wallet",
    iconUrl: trustWalletConfig.iconUrl,
    iconBackground: trustWalletConfig.iconBackground,
    downloadUrls: trustWalletConfig.downloadUrls,
    mobile: {
      getUri: (uri: string) => `trust://wc?uri=${encodeURIComponent(uri)}`,
    },
    desktop: {
      getUri: (uri: string) => uri,
    },

    createConnector: getWalletConnectConnector({ projectId }),
  };
};

export const OmniWallet = ({ projectId }: WalletOptions): Wallet => {
  const omniWalletConfig = omniWallet({ projectId });

  return {
    id: "omni",
    name: "Omni",
    iconUrl: omniWalletConfig.iconUrl,
    iconBackground: omniWalletConfig.iconBackground,
    downloadUrls: omniWalletConfig.downloadUrls,
    mobile: {
      getUri: (uri: string) => `omni://wc?uri=${encodeURIComponent(uri)}`,
    },
    desktop: {
      getUri: (uri: string) => uri,
    },

    createConnector: getWalletConnectConnector({ projectId }),
  };
};
