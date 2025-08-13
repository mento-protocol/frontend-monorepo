import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { Config, createConfig, http } from "wagmi";
import { celo, celoAlfajores, Chain } from "wagmi/chains";
import { config } from "./config";
import { cleanupStaleWalletSessions } from "./wallets";

import {
  metaMaskWallet,
  rabbyWallet,
  valoraWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { allChains, CeloWallet, TrustWallet, OmniWallet } from ".";

// Avoid creating WalletConnect connectors during SSR because they rely on
// browser-only APIs like `indexedDB`.
const isServer = typeof window === "undefined";

// Clean up stale WalletConnect sessions to prevent connection issues
if (!isServer) {
  cleanupStaleWalletSessions();
}

// Validate WalletConnect project ID
if (!isServer && !config.walletConnectProjectId) {
  console.warn(
    "NEXT_PUBLIC_WALLET_CONNECT_ID is not set. WalletConnect functionality may not work properly.",
  );
}

const connectors = isServer
  ? []
  : connectorsForWallets(
      [
        {
          groupName: "Recommended for Celo chains",
          wallets: [
            metaMaskWallet,
            valoraWallet,
            walletConnectWallet,
            () => OmniWallet({ projectId: config.walletConnectProjectId }),
            () => TrustWallet({ projectId: config.walletConnectProjectId }),
            rabbyWallet,
            () => CeloWallet({ projectId: config.walletConnectProjectId }),
          ],
        },
      ],
      {
        projectId: config.walletConnectProjectId,
        appName: "MENTO Swap",
      },
    );

export const wagmiConfig: Config = createConfig({
  chains: allChains as any satisfies Chain[],
  connectors,
  transports: {
    [celo.id]: http(),
    [celoAlfajores.id]: http(),
  },
  ssr: true,
});
