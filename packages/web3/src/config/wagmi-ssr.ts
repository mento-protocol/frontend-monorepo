import { celoSepolia } from "viem/chains";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { celo, Chain } from "wagmi/chains";
import { allChains } from "./chains";

export const wagmiSsrConfig = createConfig({
  chains: allChains as readonly [Chain, ...Chain[]],
  connectors: [],
  transports: {
    [celo.id]: http(),
    [celoSepolia.id]: http(),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});
