import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { Chain, celo, celoSepolia } from "viem/chains";
import {
  Config,
  cookieStorage,
  createConfig,
  createStorage,
  http,
} from "wagmi";
import { config } from "./config";

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
    // Use local API proxy to avoid CORS issues with public RPC endpoints
    [celo.id]: http(`/api/rpc?chainId=${celo.id}`),
    [celoSepolia.id]: http(`/api/rpc?chainId=${celoSepolia.id}`),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});
