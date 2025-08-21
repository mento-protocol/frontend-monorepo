import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  Config,
  cookieStorage,
  createConfig,
  createStorage,
  http,
} from "wagmi";
import { celo, celoAlfajores, Chain } from "wagmi/chains";
import { config } from "./config";
import { cleanupStaleWalletSessions } from "./wallets";

import {
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  valoraWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { allChains } from ".";

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
            walletConnectWallet,
            rabbyWallet,
            metaMaskWallet,
            rainbowWallet,
            valoraWallet,
          ],
        },
      ],
      {
        projectId: config.walletConnectProjectId,
        appName: "MENTO Protocol",
      },
    );

export const wagmiConfig: Config = createConfig({
  chains: allChains as readonly [Chain, ...Chain[]],

  connectors,
  transports: {
    [celo.id]: http(),
    [celoAlfajores.id]: http(),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});
