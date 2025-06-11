export enum ChainId {
  Alfajores = 44787,
  Celo = 42220,
}

export interface ChainMetadata {
  chainId: ChainId;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  explorerApiUrl: string;
}

export const Alfajores: ChainMetadata = {
  chainId: ChainId.Alfajores,
  name: "Alfajores",
  rpcUrl: "https://alfajores-forno.celo-testnet.org",
  explorerUrl: "https://alfajores.celoscan.io",
  explorerApiUrl: "https://api-alfajores.celoscan.io/api",
};

export const Celo: ChainMetadata = {
  chainId: ChainId.Celo,
  name: "Celo",
  rpcUrl: "https://forno.celo.org",
  explorerUrl: "https://celoscan.io",
  explorerApiUrl: "https://api.celoscan.io/api",
};

export const chainIdToChain: Record<number, ChainMetadata> = {
  [ChainId.Alfajores]: Alfajores,
  [ChainId.Celo]: Celo,
};

export const allChains = [Celo, Alfajores];
