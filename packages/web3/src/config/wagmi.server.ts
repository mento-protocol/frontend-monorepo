// Debug check: This file should only be imported on the server
if (typeof window !== "undefined") {
  throw new Error("wagmi.server.ts should only be imported on the server side");
}

import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { celo, celoAlfajores, type Chain } from "wagmi/chains";
import { allChains } from ".";

export const wagmiServerConfig = createConfig({
  chains: allChains as readonly [Chain, ...Chain[]],
  connectors: [],
  transports: { [celo.id]: http(), [celoAlfajores.id]: http() },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});
