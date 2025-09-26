import { GovernorABI } from "@repo/web3";
import { useContracts } from "@/contracts/use-contracts";
import { useCallback } from "react";
import {
  Address,
  Hex,
  encodeAbiParameters,
  hexToBigInt,
  isAddress,
  isHex,
  keccak256,
  parseAbiParameters,
  stringToBytes,
  toHex,
} from "viem";
import { useWriteContract } from "wagmi";
import { WriteContractErrorType } from "wagmi/actions";

export type TransactionItem = {
  address: Address;
  value: string | number | bigint;
  data: string | Hex;
};

export const isTransactionItem = (
  toBeDetermined: unknown,
): toBeDetermined is TransactionItem => {
  return (
    typeof toBeDetermined === "object" &&
    toBeDetermined !== null &&
    "address" in toBeDetermined &&
    typeof toBeDetermined["address"] === "string" &&
    isAddress(toBeDetermined["address"]) &&
    "value" in toBeDetermined &&
    (isHex(toBeDetermined["value"]) ||
      typeof toBeDetermined["value"] === "bigint" ||
      typeof toBeDetermined["value"] === "number") &&
    "data" in toBeDetermined &&
    isHex(toBeDetermined["data"])
  );
};

export type ProposalCreateParams = {
  metadata: { title: string; description: string };
  transactions: TransactionItem[];
};

export const useCreateProposalOnChain = () => {
  const {
    data,
    error,
    writeContract,
    isSuccess,
    reset: resetCreateProposalHook,
  } = useWriteContract();
  const { MentoGovernor } = useContracts();

  const createProposalID = useCallback(
    (proposal: ProposalCreateParams) =>
      hexToBigInt(
        keccak256(
          encodeAbiParameters(
            parseAbiParameters(
              "address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash",
            ),
            [
              proposal.transactions.map(
                (transaction) => transaction.address as Address,
              ),
              proposal.transactions.map((transaction) =>
                BigInt(transaction.value),
              ),
              proposal.transactions.map((transaction) =>
                isHex(transaction.data)
                  ? transaction.data
                  : toHex(transaction.data),
              ),
              keccak256(stringToBytes(JSON.stringify(proposal.metadata))),
            ],
          ),
        ),
        {
          signed: false,
          size: 256,
        },
      ).toString(),
    [],
  );

  const createProposal = useCallback(
    (
      proposal: ProposalCreateParams,
      onSuccess?: () => void,
      onError?: (error?: WriteContractErrorType) => void,
    ) => {
      writeContract(
        {
          address: MentoGovernor.address as Address,
          abi: GovernorABI,
          functionName: "propose",
          args: [
            proposal.transactions.map(
              (transaction) => transaction.address as Address,
            ),
            proposal.transactions.map((transaction) =>
              BigInt(transaction.value),
            ),
            proposal.transactions.map((transaction) =>
              isHex(transaction.data)
                ? transaction.data
                : toHex(transaction.data),
            ),
            JSON.stringify(proposal.metadata),
          ],
        },
        {
          onSuccess,
          onError,
        },
      );
    },
    [writeContract, MentoGovernor.address],
  );

  return {
    createProposal,
    createError: error,
    createTx: data,
    isSuccess,
    createProposalID,
    resetCreateProposalHook,
  };
};
