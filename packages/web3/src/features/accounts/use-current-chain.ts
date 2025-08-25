"use client";

import { Alfajores, Celo } from "@/config/chains";
import { useAccount } from "wagmi";

export const useCurrentChain = () => {
  const { chainId } = useAccount();

  return chainId === Alfajores.id ? Alfajores : Celo;
};
