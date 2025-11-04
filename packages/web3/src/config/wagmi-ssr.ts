import { Chain, celo, celoSepolia } from "viem/chains";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { allChains, CeloMainnetFork } from "./chains";

export const wagmiSsrConfig = createConfig({
  chains: allChains as readonly [Chain, ...Chain[]],
  connectors: [],
  transports: {
    [celo.id]: http(),
    [celoSepolia.id]: http(),
    [CeloMainnetFork.id]: http(),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});
