"use client";

import { CeloSepolia, Celo } from "@repo/web3";
import { useAccount } from "wagmi";

export const useCurrentChain = () => {
  const { chainId } = useAccount();

  return chainId === CeloSepolia.id ? CeloSepolia : Celo;
};
