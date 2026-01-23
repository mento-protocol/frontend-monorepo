import { ContractAddresses } from "@mento-protocol/mento-sdk";
import { Chain } from "@rainbow-me/rainbowkit";
import { ChainContract } from "viem";

// All contract addresses are required in the chain config, even though
// ContractAddresses from the SDK marks them as optional (since not all
// chains have all contracts). Our Celo chain configs define all contracts.
export type MentoChainContracts = {
  [K in keyof ContractAddresses]-?: ChainContract;
};

export type MentoChain = Chain;

export type TokenBalance = {
  decimals: number;
  value: bigint;
  symbol: string;
  formatted: string;
};
