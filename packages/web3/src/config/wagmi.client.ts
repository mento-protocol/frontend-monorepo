"use client";

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

import {
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  valoraWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { allChains } from ".";

if (!config.walletConnectProjectId) {
  console.warn(
    "NEXT_PUBLIC_WALLET_CONNECT_ID is not set. WalletConnect functionality may not work properly.",
  );
}

const connectors = connectorsForWallets(
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

export const wagmiClientConfig: Config = createConfig({
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
