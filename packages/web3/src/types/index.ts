import { ContractAddresses } from "@mento-protocol/mento-sdk";
import { Chain } from "@rainbow-me/rainbowkit";
import { ChainContract } from "viem";

export type MentoChainContracts = {
  [K in keyof ContractAddresses]: ChainContract;
};

export type MentoChain = Chain;

export type TokenBalance = {
  decimals: number;
  value: bigint;
  symbol: string;
  formatted: string;
};
