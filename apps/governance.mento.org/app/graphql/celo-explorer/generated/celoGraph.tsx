/* eslint-disable */
import { gql } from "@apollo/client";
import * as Apollo from "@apollo/client";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
const defaultOptions = {} as const;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  AddressHash: { input: any; output: any };
  Data: { input: any; output: any };
  DateTime: { input: any; output: any };
  Decimal: { input: any; output: any };
  FullHash: { input: any; output: any };
  Json: { input: any; output: any };
  NonceHash: { input: any; output: any };
  Wei: { input: any; output: any };
};

/** A stored representation of a Web3 address. */
export type Address = {
  __typename?: "Address";
  contractCode?: Maybe<Scalars["Data"]["output"]>;
  fetchedCoinBalance?: Maybe<Scalars["Wei"]["output"]>;
  fetchedCoinBalanceBlockNumber?: Maybe<Scalars["Int"]["output"]>;
  gasUsed?: Maybe<Scalars["Int"]["output"]>;
  hash?: Maybe<Scalars["AddressHash"]["output"]>;
  nonce?: Maybe<Scalars["Int"]["output"]>;
  smartContract?: Maybe<SmartContract>;
  tokenTransfers?: Maybe<TokenTransferConnection>;
  tokenTransfersCount?: Maybe<Scalars["Int"]["output"]>;
  transactions?: Maybe<TransactionConnection>;
  transactionsCount?: Maybe<Scalars["Int"]["output"]>;
};

/** A stored representation of a Web3 address. */
export type AddressTokenTransfersArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  count?: InputMaybe<Scalars["Int"]["input"]>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  last?: InputMaybe<Scalars["Int"]["input"]>;
};

/** A stored representation of a Web3 address. */
export type AddressTransactionsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  count?: InputMaybe<Scalars["Int"]["input"]>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  last?: InputMaybe<Scalars["Int"]["input"]>;
  order?: InputMaybe<SortOrder>;
};

/**
 * A package of data that contains zero or more transactions, the hash of the previous block ("parent"), and optionally
 * other data. Because each block (except for the initial "genesis block") points to the previous block, the data
 * structure that they form is called a "blockchain".
 */
export type Block = {
  __typename?: "Block";
  baseFeePerGas?: Maybe<Scalars["Wei"]["output"]>;
  consensus?: Maybe<Scalars["Boolean"]["output"]>;
  difficulty?: Maybe<Scalars["Decimal"]["output"]>;
  gasLimit?: Maybe<Scalars["Decimal"]["output"]>;
  gasUsed?: Maybe<Scalars["Decimal"]["output"]>;
  hash?: Maybe<Scalars["FullHash"]["output"]>;
  isEmpty?: Maybe<Scalars["Boolean"]["output"]>;
  minerHash?: Maybe<Scalars["AddressHash"]["output"]>;
  nonce?: Maybe<Scalars["NonceHash"]["output"]>;
  number?: Maybe<Scalars["Int"]["output"]>;
  parentHash?: Maybe<Scalars["FullHash"]["output"]>;
  size?: Maybe<Scalars["Int"]["output"]>;
  timestamp?: Maybe<Scalars["DateTime"]["output"]>;
  totalDifficulty?: Maybe<Scalars["Decimal"]["output"]>;
};

export enum CallType {
  Call = "CALL",
  Callcode = "CALLCODE",
  Delegatecall = "DELEGATECALL",
  Staticcall = "STATICCALL",
}

/** Represents a CELO or usd token transfer between addresses. */
export type CeloTransfer = Node & {
  __typename?: "CeloTransfer";
  blockNumber?: Maybe<Scalars["Int"]["output"]>;
  comment?: Maybe<Scalars["String"]["output"]>;
  fromAccountHash?: Maybe<Scalars["AddressHash"]["output"]>;
  fromAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  gasPrice?: Maybe<Scalars["Wei"]["output"]>;
  gasUsed?: Maybe<Scalars["Decimal"]["output"]>;
  /** The ID of an object */
  id: Scalars["ID"]["output"];
  input?: Maybe<Scalars["String"]["output"]>;
  logIndex?: Maybe<Scalars["Int"]["output"]>;
  timestamp?: Maybe<Scalars["DateTime"]["output"]>;
  toAccountHash?: Maybe<Scalars["AddressHash"]["output"]>;
  toAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  token?: Maybe<Scalars["String"]["output"]>;
  tokenAddress?: Maybe<Scalars["String"]["output"]>;
  tokenId?: Maybe<Scalars["Decimal"]["output"]>;
  tokenType?: Maybe<Scalars["String"]["output"]>;
  transactionHash?: Maybe<Scalars["FullHash"]["output"]>;
  value?: Maybe<Scalars["Decimal"]["output"]>;
};

export type CeloTransferConnection = {
  __typename?: "CeloTransferConnection";
  edges?: Maybe<Array<Maybe<CeloTransferEdge>>>;
  pageInfo: PageInfo;
};

export type CeloTransferEdge = {
  __typename?: "CeloTransferEdge";
  cursor?: Maybe<Scalars["String"]["output"]>;
  node?: Maybe<CeloTransfer>;
};

/** Models internal transactions. */
export type InternalTransaction = Node & {
  __typename?: "InternalTransaction";
  blockHash?: Maybe<Scalars["FullHash"]["output"]>;
  blockIndex?: Maybe<Scalars["Int"]["output"]>;
  blockNumber?: Maybe<Scalars["Int"]["output"]>;
  callType?: Maybe<CallType>;
  createdContractAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  createdContractCode?: Maybe<Scalars["Data"]["output"]>;
  error?: Maybe<Scalars["String"]["output"]>;
  fromAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  gas?: Maybe<Scalars["Decimal"]["output"]>;
  gasUsed?: Maybe<Scalars["Decimal"]["output"]>;
  /** The ID of an object */
  id: Scalars["ID"]["output"];
  index?: Maybe<Scalars["Int"]["output"]>;
  init?: Maybe<Scalars["Data"]["output"]>;
  input?: Maybe<Scalars["Data"]["output"]>;
  output?: Maybe<Scalars["Data"]["output"]>;
  toAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  traceAddress?: Maybe<Scalars["Json"]["output"]>;
  transactionHash?: Maybe<Scalars["FullHash"]["output"]>;
  transactionIndex?: Maybe<Scalars["Int"]["output"]>;
  type?: Maybe<Type>;
  value?: Maybe<Scalars["Wei"]["output"]>;
};

export type InternalTransactionConnection = {
  __typename?: "InternalTransactionConnection";
  edges?: Maybe<Array<Maybe<InternalTransactionEdge>>>;
  pageInfo: PageInfo;
};

export type InternalTransactionEdge = {
  __typename?: "InternalTransactionEdge";
  cursor?: Maybe<Scalars["String"]["output"]>;
  node?: Maybe<InternalTransaction>;
};

export enum Language {
  Solidity = "SOLIDITY",
  Vyper = "VYPER",
  Yul = "YUL",
}

export type Node = {
  /** The ID of the object. */
  id: Scalars["ID"]["output"];
};

export type PageInfo = {
  __typename?: "PageInfo";
  /** When paginating forwards, the cursor to continue. */
  endCursor?: Maybe<Scalars["String"]["output"]>;
  /** When paginating forwards, are there more items? */
  hasNextPage: Scalars["Boolean"]["output"];
  /** When paginating backwards, are there more items? */
  hasPreviousPage: Scalars["Boolean"]["output"];
  /** When paginating backwards, the cursor to continue. */
  startCursor?: Maybe<Scalars["String"]["output"]>;
};

export type RootQueryType = {
  __typename?: "RootQueryType";
  /** Gets an address by hash. */
  address?: Maybe<Address>;
  /** Gets addresses by address hash. */
  addresses?: Maybe<Array<Maybe<Address>>>;
  /** Gets a block by number. */
  block?: Maybe<Block>;
  node?: Maybe<Node>;
  /** Gets token transfer transactions. */
  tokenTransferTxs?: Maybe<TransferTransactionConnection>;
  /** Gets token transfers by token contract address hash. */
  tokenTransfers?: Maybe<TokenTransferConnection>;
  /** Gets a transaction by hash. */
  transaction?: Maybe<Transaction>;
};

export type RootQueryTypeAddressArgs = {
  hash: Scalars["AddressHash"]["input"];
};

export type RootQueryTypeAddressesArgs = {
  hashes: Array<Scalars["AddressHash"]["input"]>;
};

export type RootQueryTypeBlockArgs = {
  number: Scalars["Int"]["input"];
};

export type RootQueryTypeNodeArgs = {
  id: Scalars["ID"]["input"];
};

export type RootQueryTypeTokenTransferTxsArgs = {
  addressHash?: InputMaybe<Scalars["AddressHash"]["input"]>;
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  count?: InputMaybe<Scalars["Int"]["input"]>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  last?: InputMaybe<Scalars["Int"]["input"]>;
};

export type RootQueryTypeTokenTransfersArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  count?: InputMaybe<Scalars["Int"]["input"]>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  last?: InputMaybe<Scalars["Int"]["input"]>;
  tokenContractAddressHash: Scalars["AddressHash"]["input"];
};

export type RootQueryTypeTransactionArgs = {
  hash: Scalars["FullHash"]["input"];
};

export type RootSubscriptionType = {
  __typename?: "RootSubscriptionType";
  tokenTransfers?: Maybe<Array<Maybe<TokenTransfer>>>;
};

export type RootSubscriptionTypeTokenTransfersArgs = {
  tokenContractAddressHash: Scalars["AddressHash"]["input"];
};

/**
 * The representation of a verified Smart Contract.
 *
 * "A contract in the sense of Solidity is a collection of code (its functions)
 * and data (its state) that resides at a specific address on the Ethereum
 * blockchain."
 * http://solidity.readthedocs.io/en/v0.4.24/introduction-to-smart-contracts.html
 */
export type SmartContract = {
  __typename?: "SmartContract";
  abi?: Maybe<Scalars["Json"]["output"]>;
  addressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  compilerSettings?: Maybe<Scalars["Json"]["output"]>;
  compilerVersion?: Maybe<Scalars["String"]["output"]>;
  constructorArguments?: Maybe<Scalars["String"]["output"]>;
  contractSourceCode?: Maybe<Scalars["String"]["output"]>;
  evmVersion?: Maybe<Scalars["String"]["output"]>;
  externalLibraries?: Maybe<Scalars["Json"]["output"]>;
  filePath?: Maybe<Scalars["String"]["output"]>;
  isChangedBytecode?: Maybe<Scalars["Boolean"]["output"]>;
  language?: Maybe<Language>;
  name?: Maybe<Scalars["String"]["output"]>;
  optimization?: Maybe<Scalars["Boolean"]["output"]>;
  optimizationRuns?: Maybe<Scalars["Int"]["output"]>;
  partiallyVerified?: Maybe<Scalars["Boolean"]["output"]>;
  verifiedViaEthBytecodeDb?: Maybe<Scalars["Boolean"]["output"]>;
  verifiedViaSourcify?: Maybe<Scalars["Boolean"]["output"]>;
};

export enum SortOrder {
  Asc = "ASC",
  Desc = "DESC",
}

export enum Status {
  Error = "ERROR",
  Ok = "OK",
}

/** Represents a token. */
export type Token = {
  __typename?: "Token";
  circulatingMarketCap?: Maybe<Scalars["Decimal"]["output"]>;
  contractAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  decimals?: Maybe<Scalars["Decimal"]["output"]>;
  holderCount?: Maybe<Scalars["Int"]["output"]>;
  iconUrl?: Maybe<Scalars["String"]["output"]>;
  name?: Maybe<Scalars["String"]["output"]>;
  symbol?: Maybe<Scalars["String"]["output"]>;
  totalSupply?: Maybe<Scalars["Decimal"]["output"]>;
  type?: Maybe<Scalars["String"]["output"]>;
  volume24h?: Maybe<Scalars["Decimal"]["output"]>;
};

/** Represents a token transfer between addresses. */
export type TokenTransfer = Node & {
  __typename?: "TokenTransfer";
  amount?: Maybe<Scalars["Decimal"]["output"]>;
  amounts?: Maybe<Array<Maybe<Scalars["Decimal"]["output"]>>>;
  blockNumber?: Maybe<Scalars["Int"]["output"]>;
  fromAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  /** The ID of an object */
  id: Scalars["ID"]["output"];
  logIndex?: Maybe<Scalars["Int"]["output"]>;
  toAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  token?: Maybe<Token>;
  tokenContractAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  tokenIds?: Maybe<Array<Maybe<Scalars["Decimal"]["output"]>>>;
  transaction?: Maybe<Transaction>;
  transactionHash?: Maybe<Scalars["FullHash"]["output"]>;
};

export type TokenTransferConnection = {
  __typename?: "TokenTransferConnection";
  edges?: Maybe<Array<Maybe<TokenTransferEdge>>>;
  pageInfo: PageInfo;
};

export type TokenTransferEdge = {
  __typename?: "TokenTransferEdge";
  cursor?: Maybe<Scalars["String"]["output"]>;
  node?: Maybe<TokenTransfer>;
};

/** Models a Web3 transaction. */
export type Transaction = Node & {
  __typename?: "Transaction";
  block?: Maybe<Block>;
  blockHash?: Maybe<Scalars["FullHash"]["output"]>;
  blockNumber?: Maybe<Scalars["Int"]["output"]>;
  createdContractAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  cumulativeGasUsed?: Maybe<Scalars["Decimal"]["output"]>;
  earliestProcessingStart?: Maybe<Scalars["DateTime"]["output"]>;
  error?: Maybe<Scalars["String"]["output"]>;
  fromAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  gas?: Maybe<Scalars["Decimal"]["output"]>;
  gasPrice?: Maybe<Scalars["Wei"]["output"]>;
  gasTokenContractAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  gasUsed?: Maybe<Scalars["Decimal"]["output"]>;
  hasErrorInInternalTransactions?: Maybe<Scalars["Boolean"]["output"]>;
  hash?: Maybe<Scalars["FullHash"]["output"]>;
  /** The ID of an object */
  id: Scalars["ID"]["output"];
  index?: Maybe<Scalars["Int"]["output"]>;
  input?: Maybe<Scalars["String"]["output"]>;
  internalTransactions?: Maybe<InternalTransactionConnection>;
  maxFeePerGas?: Maybe<Scalars["Wei"]["output"]>;
  maxPriorityFeePerGas?: Maybe<Scalars["Wei"]["output"]>;
  nonce?: Maybe<Scalars["NonceHash"]["output"]>;
  r?: Maybe<Scalars["Decimal"]["output"]>;
  revertReason?: Maybe<Scalars["String"]["output"]>;
  s?: Maybe<Scalars["Decimal"]["output"]>;
  status?: Maybe<Status>;
  toAddressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  type?: Maybe<Scalars["Int"]["output"]>;
  v?: Maybe<Scalars["Decimal"]["output"]>;
  value?: Maybe<Scalars["Wei"]["output"]>;
};

/** Models a Web3 transaction. */
export type TransactionInternalTransactionsArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  count?: InputMaybe<Scalars["Int"]["input"]>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  last?: InputMaybe<Scalars["Int"]["input"]>;
};

export type TransactionConnection = {
  __typename?: "TransactionConnection";
  edges?: Maybe<Array<Maybe<TransactionEdge>>>;
  pageInfo: PageInfo;
};

export type TransactionEdge = {
  __typename?: "TransactionEdge";
  cursor?: Maybe<Scalars["String"]["output"]>;
  node?: Maybe<Transaction>;
};

/** Represents a CELO token transfer between addresses. */
export type TransferTransaction = Node & {
  __typename?: "TransferTransaction";
  addressHash?: Maybe<Scalars["AddressHash"]["output"]>;
  blockNumber?: Maybe<Scalars["Int"]["output"]>;
  feeCurrency?: Maybe<Scalars["AddressHash"]["output"]>;
  feeToken?: Maybe<Scalars["String"]["output"]>;
  gasPrice?: Maybe<Scalars["Wei"]["output"]>;
  gasUsed?: Maybe<Scalars["Decimal"]["output"]>;
  gatewayFee?: Maybe<Scalars["AddressHash"]["output"]>;
  gatewayFeeRecipient?: Maybe<Scalars["AddressHash"]["output"]>;
  /** The ID of an object */
  id: Scalars["ID"]["output"];
  input?: Maybe<Scalars["String"]["output"]>;
  timestamp?: Maybe<Scalars["DateTime"]["output"]>;
  tokenTransfer?: Maybe<CeloTransferConnection>;
  transactionHash?: Maybe<Scalars["FullHash"]["output"]>;
};

/** Represents a CELO token transfer between addresses. */
export type TransferTransactionTokenTransferArgs = {
  after?: InputMaybe<Scalars["String"]["input"]>;
  before?: InputMaybe<Scalars["String"]["input"]>;
  count?: InputMaybe<Scalars["Int"]["input"]>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  last?: InputMaybe<Scalars["Int"]["input"]>;
};

export type TransferTransactionConnection = {
  __typename?: "TransferTransactionConnection";
  edges?: Maybe<Array<Maybe<TransferTransactionEdge>>>;
  pageInfo: PageInfo;
};

export type TransferTransactionEdge = {
  __typename?: "TransferTransactionEdge";
  cursor?: Maybe<Scalars["String"]["output"]>;
  node?: Maybe<TransferTransaction>;
};

export enum Type {
  Call = "CALL",
  Create = "CREATE",
  Reward = "REWARD",
  Selfdestruct = "SELFDESTRUCT",
}

export type GetContractsInfoQueryVariables = Exact<{
  addresses:
    | Array<Scalars["AddressHash"]["input"]>
    | Scalars["AddressHash"]["input"];
}>;

export type GetContractsInfoQuery = {
  __typename?: "RootQueryType";
  addresses?: Array<{
    __typename?: "Address";
    hash?: any | null;
    smartContract?: {
      __typename?: "SmartContract";
      name?: string | null;
      abi?: any | null;
    } | null;
  } | null> | null;
};

export const GetContractsInfoDocument = gql`
  query getContractsInfo($addresses: [AddressHash!]!) {
    addresses(hashes: $addresses) {
      hash
      smartContract {
        name
        abi
      }
    }
  }
`;

/**
 * __useGetContractsInfoQuery__
 *
 * To run a query within a React component, call `useGetContractsInfoQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetContractsInfoQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetContractsInfoQuery({
 *   variables: {
 *      addresses: // value for 'addresses'
 *   },
 * });
 */
export function useGetContractsInfoQuery(
  baseOptions: Apollo.QueryHookOptions<
    GetContractsInfoQuery,
    GetContractsInfoQueryVariables
  > &
    (
      | { variables: GetContractsInfoQueryVariables; skip?: boolean }
      | { skip: boolean }
    ),
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useQuery<GetContractsInfoQuery, GetContractsInfoQueryVariables>(
    GetContractsInfoDocument,
    options,
  );
}
export function useGetContractsInfoLazyQuery(
  baseOptions?: Apollo.LazyQueryHookOptions<
    GetContractsInfoQuery,
    GetContractsInfoQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useLazyQuery<
    GetContractsInfoQuery,
    GetContractsInfoQueryVariables
  >(GetContractsInfoDocument, options);
}
export function useGetContractsInfoSuspenseQuery(
  baseOptions?:
    | Apollo.SkipToken
    | Apollo.SuspenseQueryHookOptions<
        GetContractsInfoQuery,
        GetContractsInfoQueryVariables
      >,
) {
  const options =
    baseOptions === Apollo.skipToken
      ? baseOptions
      : { ...defaultOptions, ...baseOptions };
  return Apollo.useSuspenseQuery<
    GetContractsInfoQuery,
    GetContractsInfoQueryVariables
  >(GetContractsInfoDocument, options);
}
export type GetContractsInfoQueryHookResult = ReturnType<
  typeof useGetContractsInfoQuery
>;
export type GetContractsInfoLazyQueryHookResult = ReturnType<
  typeof useGetContractsInfoLazyQuery
>;
export type GetContractsInfoSuspenseQueryHookResult = ReturnType<
  typeof useGetContractsInfoSuspenseQuery
>;
export type GetContractsInfoQueryResult = Apollo.QueryResult<
  GetContractsInfoQuery,
  GetContractsInfoQueryVariables
>;
