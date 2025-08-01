import { ChainId } from "@/config";
import { ContractAddresses } from "@mento-protocol/mento-sdk";
import { ChainContract } from "viem";

export type MentoChainContracts = {
  [K in keyof ContractAddresses]: ChainContract;
};

export interface ChainMetadata {
  id: ChainId;
  chainId: ChainId;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  explorerApiUrl: string;
}

export type MentoChain = ChainMetadata & {
  contracts: MentoChainContracts;
};

import { Lock } from "../graphql";

export interface LockWithExpiration extends Lock {
  expiration: Date;
}
