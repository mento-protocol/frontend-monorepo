"use client";
import { env } from "@/env.mjs";
import { Alfajores, Celo } from "@/lib/config/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  safeWallet,
  walletConnectWallet,
  metaMaskWallet,
  rainbowWallet,
  valoraWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, createStorage, cookieStorage } from "wagmi";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [
        metaMaskWallet,
        safeWallet,
        valoraWallet,
        rainbowWallet,
        walletConnectWallet,
      ],
    },
  ],
  {
    appName: "Mento Governance",
    projectId: env.NEXT_PUBLIC_WALLET_CONNECT_ID,
  },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [Celo, Alfajores],
  transports: {
    [Celo.id]: http(),
    [Alfajores.id]: http(),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});
