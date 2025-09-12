import { Abi } from "viem";

export interface ABIResponse {
  source: string;
  abi?: Abi;
  proxyABI?: Abi;
  implementationABI?: Abi;
  proxyAddress?: string;
  implementationAddress?: string;
  isProxy?: boolean;
}

export interface ContractInfo {
  name: string;
  source: "celoscan" | "blockscout";
  isProxy?: boolean;
  implementationAddress?: string;
}
