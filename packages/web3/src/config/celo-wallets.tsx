import { tryClipboardSet } from "@/utils/clipboard";
import type { Wallet } from "@rainbow-me/rainbowkit";
import { getWalletConnectConnector } from "@rainbow-me/rainbowkit";
import { toast } from "@repo/ui";

function isAndroid(): boolean {
  return (
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
  );
}

interface WalletOptions {
  projectId: string;
}

export const Valora = ({ projectId }: WalletOptions): Wallet => ({
  id: "valora",
  name: "Valora",
  iconUrl:
    "https://registry.walletconnect.com/api/v1/logo/md/d01c7758d741b363e637a817a09bcf579feae4db9f5bb16f599fdd1f66e2f974",
  iconBackground: "#FFF",
  downloadUrls: {
    android: "https://play.google.com/store/apps/details?id=co.clabs.valora",
    ios: "https://apps.apple.com/app/id1520414263?mt=8",
    qrCode: "https://valoraapp.com/",
  },

  // ⬇️ UI config lives at top-level now
  mobile: {
    getUri: (uri: string) =>
      isAndroid() ? uri : `celo://wallet/wc?uri=${encodeURIComponent(uri)}`,
  },
  qrCode: {
    getUri: (uri: string) => uri,
    instructions: {
      learnMoreUrl: "https://valoraapp.com/learn",
      steps: [
        {
          step: "install",
          title: "Open the Valora app",
          description:
            "The crypto wallet to buy, send, spend, earn, and collect NFTs on the Celo blockchain.",
        },
        {
          step: "scan",
          title: "Tap the scan button",
          description:
            "After you scan, a connection prompt will appear for you to connect your wallet.",
        },
      ],
    },
  },

  // ⬇️ v2 expects a function; RainbowKit will call it for you
  createConnector: getWalletConnectConnector({ projectId }),
});

export const CeloTerminal = ({ projectId }: WalletOptions): Wallet => ({
  id: "celo-terminal",
  name: "Celo Terminal",
  iconUrl: "./wallets/celo-terminal.svg",
  iconBackground: "#FFF",

  qrCode: {
    getUri: (uri: string) => {
      tryClipboardSet(uri);
      toast.success("WalletConnect URL copied to clipboard");
      return uri;
    },
  },

  createConnector: getWalletConnectConnector({ projectId }),
});

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
