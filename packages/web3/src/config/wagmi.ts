import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { Chain } from "viem/chains";
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
import { Celo, CeloSepolia, Monad, MonadTestnet, allChains } from "./chains";

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
          groupName: "Recommended",
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
    [Celo.id]: http(Celo.rpcUrls.default.http[0]),
    [CeloSepolia.id]: http(CeloSepolia.rpcUrls.default.http[0]),
    [Monad.id]: http(Monad.rpcUrls.default.http[0]),
    [MonadTestnet.id]: http(MonadTestnet.rpcUrls.default.http[0]),
  },
  // Viem v2.44+ derives pollingInterval from chain.blockTime (blockTime/2, min 500ms).
  // Monad has blockTime: 400ms → 500ms default, which is far too aggressive for HTTP RPC.
  // Override Monad chains to 4s; Celo chains default to 4s via their blockTime (5s → 2500ms
  // clamped to 4000ms), so no explicit override is needed there.
  pollingInterval: {
    [Monad.id]: 4_000,
    [MonadTestnet.id]: 4_000,
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});
