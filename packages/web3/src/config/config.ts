"use client";

import { celo, celoAlfajores } from "viem/chains";

interface Config {
  debug: boolean;
  version: string | null;
  showPriceChart: boolean;
  walletConnectProjectId: string;
}

const isDevMode = process.env.NODE_ENV === "development";
const version = process.env.NEXT_PUBLIC_VERSION ?? null;
const walletConnectProjectId = process.env
  .NEXT_PUBLIC_WALLET_CONNECT_ID as string;

export const config: Config = Object.freeze({
  debug: isDevMode,
  version,
  showPriceChart: false,
  walletConnectProjectId,
});

export const subgraphApiNames = {
  [celoAlfajores.id]: "subgraphAlfajores",
  [celo.id]: "subgraph",
  // Considered default
  [0]: "subgraph",
};

export const isValidChainId = (
  k: number,
): k is keyof typeof subgraphApiNames => {
  return k in subgraphApiNames;
};

export const getSubgraphApiName = (chainId: number | undefined) => {
  if (!chainId || !isValidChainId(chainId)) return subgraphApiNames[0];
  return subgraphApiNames[chainId];
};

export const CELO_BLOCK_TIME = 1000; // 1 seconds
