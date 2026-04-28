const CHAIN_LABEL: Record<string, string> = {
  celo: "Celo",
  ethereum: "Ethereum",
  monad: "Monad",
  bitcoin: "Bitcoin",
};

export const CHAIN_ICON: Record<string, string> = {
  celo: "/chains/celo.svg",
  ethereum: "/tokens/ETH.svg",
  monad: "/chains/monad.svg",
  bitcoin: "/tokens/BTC.svg",
};

export function chainLabel(chain: string): string {
  return CHAIN_LABEL[chain] ?? chain;
}
