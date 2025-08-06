import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { Config, createConfig, http } from "wagmi";
import { celo, celoAlfajores, Chain } from "wagmi/chains";
import { config } from "./config";

import {
  metaMaskWallet,
  omniWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { allChains } from ".";

// Avoid creating WalletConnect connectors during SSR because they rely on
// browser-only APIs like `indexedDB`.
const isServer = typeof window === "undefined";

const connectors = isServer
  ? []
  : connectorsForWallets(
      [
        {
          groupName: "Recommended for Celo chains",
          wallets: [
            metaMaskWallet,
            walletConnectWallet,
            omniWallet,
            trustWallet,
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
