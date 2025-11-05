export interface Transaction {
  address: string;
  value: string | number;
  data: string;
}

export interface DecodedTransaction {
  functionName: string;
  functionSignature: string;
  args?: DecodedArg[];
}

interface DecodedArg {
  name: string;
  type: string;
  value: string | number | boolean | bigint;
}

export interface TransactionSummary {
  description: string;
  confidence: "high" | "medium" | "low";
}

export interface ContractInfo {
  name: string;
  symbol?: string;
  decimals?: number;
  friendlyName?: string;
  isProxy?: boolean;
  implementationAddress?: string;
}
