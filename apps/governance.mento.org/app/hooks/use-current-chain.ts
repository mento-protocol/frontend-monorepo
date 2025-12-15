"use client";

import { CeloSepolia, Celo } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";

export const useCurrentChain = () => {
  const { chainId } = useAccount();

  return chainId === CeloSepolia.id ? CeloSepolia : Celo;
};
