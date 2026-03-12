import { ChainId } from "./chains";

const CHAIN_SLUG_TO_ID: Record<string, ChainId> = {
  celo: ChainId.Celo,
  "celo-sepolia": ChainId.CeloSepolia,
  monad: ChainId.Monad,
  "monad-testnet": ChainId.MonadTestnet,
};

const CHAIN_ID_TO_SLUG = Object.fromEntries(
  Object.entries(CHAIN_SLUG_TO_ID).map(([slug, id]) => [id, slug]),
) as Record<ChainId, string>;

export function chainSlugToId(slug: string): ChainId | undefined {
  return CHAIN_SLUG_TO_ID[slug.toLowerCase()];
}

export function chainIdToSlug(chainId: number): string | undefined {
  return CHAIN_ID_TO_SLUG[chainId as ChainId];
}
