"use client";

import { Celo, CeloSepolia } from "@/config/chains";
import { useAccount } from "@/wagmi";

export const useCurrentChain = () => {
  const { chainId } = useAccount();

  return chainId === CeloSepolia.id ? CeloSepolia : Celo;
};
