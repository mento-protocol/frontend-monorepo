import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { Config, createConfig, http } from "wagmi";
import { celo, celoAlfajores } from "wagmi/chains";
import { config } from "./config";

import {
  metaMaskWallet,
  omniWallet,
  trustWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";

export const chains = [celo, celoAlfajores] as const;

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended for Celo chains",
      wallets: [metaMaskWallet, walletConnectWallet, omniWallet, trustWallet],
    },
  ],
  {
    projectId: config.walletConnectProjectId,
    appName: "MENTO Swap",
  },
);

export const wagmiConfig: Config = createConfig({
  chains,
  connectors,
  transports: {
    [celo.id]: http(celo.rpcUrls.default.http[0]),
    [celoAlfajores.id]: http(celoAlfajores.rpcUrls.default.http[0]),
  },
  ssr: true,
});
