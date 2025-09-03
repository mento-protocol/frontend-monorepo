import {
  Config,
  cookieStorage,
  createConfig,
  type CreateConnectorFn,
  createStorage,
  http,
} from "wagmi";
import { celo, celoAlfajores, Chain } from "wagmi/chains";
import { allChains } from ".";
import { config } from "./config";

const isServer = typeof window === "undefined";

const connectors: CreateConnectorFn[] = [];
if (!isServer) {
  if (!config.walletConnectProjectId) {
    console.warn(
      "NEXT_PUBLIC_WALLET_CONNECT_ID is not set. WalletConnect functionality may not work properly.",
    );
  }

  (async () => {
    try {
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
