import {
  Config,
  cookieStorage,
  createConfig,
  CreateConnectorFn,
  createStorage,
  http,
} from "wagmi";
import { celo, celoAlfajores, Chain } from "wagmi/chains";
import { allChains } from ".";
import { config } from "./config";
import { cleanupStaleWalletSessions } from "./wallets";

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

// Create connectors with conditional loading to prevent SSR issues
let connectors: CreateConnectorFn[] = [];

if (!isServer) {
  // Use a self-executing async function to load connectors on client side
  (async () => {
    try {
      // Dynamic imports to prevent SSR issues with browser-only modules
      const { connectorsForWallets } = await import("@rainbow-me/rainbowkit");
      const {
        metaMaskWallet,
        rabbyWallet,
        rainbowWallet,
        valoraWallet,
        walletConnectWallet,
      } = await import("@rainbow-me/rainbowkit/wallets");

      const loadedConnectors = connectorsForWallets(
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

      // Update the connectors array
      connectors.splice(0, connectors.length, ...loadedConnectors);
    } catch (error) {
      console.error("Failed to load wallet connectors:", error);
    }
  })();
}

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
