import { Chain } from "viem/chains";
import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { Celo, CeloSepolia, Monad, MonadTestnet, allChains } from "./chains";

export const wagmiSsrConfig = createConfig({
  chains: allChains as readonly [Chain, ...Chain[]],
  connectors: [],
  transports: {
    [Celo.id]: http(Celo.rpcUrls.default.http[0]),
    [CeloSepolia.id]: http(CeloSepolia.rpcUrls.default.http[0]),
    [Monad.id]: http(Monad.rpcUrls.default.http[0]),
    [MonadTestnet.id]: http(MonadTestnet.rpcUrls.default.http[0]),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});
