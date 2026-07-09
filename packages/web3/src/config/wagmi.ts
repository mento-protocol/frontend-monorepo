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
import { isE2eTestMode } from "./e2e-mode";
import { e2eTestWallet } from "./test-wallet";

import {
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  valoraWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import {
  Celo,
  CeloSepolia,
  Monad,
  MonadTestnet,
  PolygonAmoy,
  BaseSepolia,
  allChains,
} from "./chains";

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
  : isE2eTestMode()
    ? connectorsForWallets([{ groupName: "E2E", wallets: [e2eTestWallet] }], {
        // The test wallet never uses WalletConnect. RainbowKit only validates
        // projectId inside getWalletConnectConnector, which is never invoked
        // for this wallet (verified in @rainbow-me/rainbowkit 2.2.11), so a
        // placeholder is safe when NEXT_PUBLIC_WALLET_CONNECT_ID is unset.
        projectId: config.walletConnectProjectId || "e2e-test",
        appName: "MENTO Protocol",
      })
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
    [PolygonAmoy.id]: http(PolygonAmoy.rpcUrls.default.http[0]),
    [BaseSepolia.id]: http(BaseSepolia.rpcUrls.default.http[0]),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});
