"use client";

import { Alfajores, Celo } from "@repo/web3";
import { useAccount } from "wagmi";

export const useCurrentChain = () => {
  const { chainId } = useAccount();

  return chainId === Alfajores.id ? Alfajores : Celo;
};
