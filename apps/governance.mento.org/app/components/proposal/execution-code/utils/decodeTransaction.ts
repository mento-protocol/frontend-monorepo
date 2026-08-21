import { ABIResponse } from "@/api/contract/types";
import { DecodedTransaction, Transaction } from "../../types/transaction";
import { isProxyFunctionCall } from "./isProxyFunctionCall";
import { Abi, type AbiParameter, decodeFunctionData } from "viem";

import { ADDRESS_SCOPED_ABIS, KNOWN_ABIS } from "./decodeWithLocalAbi";

/**
 * Generalized function to decode a transaction with fallback logic
 */
export async function decodeTransaction(
  rawTx: Transaction,
  abiMap: Map<string, ABIResponse | null>,
): Promise<DecodedTransaction | null> {
  // First try to decode with local ABIs
  let decodedTx = decodeWithLocalAbi(rawTx);

  // If local decoding succeeded and it's not an unknown function, return it
  if (decodedTx && !decodedTx.functionName.startsWith("Unknown function")) {
    return decodedTx;
  }

  // If local decoding failed or returned unknown function, try with fetched ABI
  if (!decodedTx || decodedTx.functionName.startsWith("Unknown function")) {
    const abiResponse = abiMap.get(rawTx.address);
    decodedTx = await decodeWithRemoteABI(rawTx, abiResponse);
  }

  return decodedTx;
}

/**
 * Decode transaction with locally stored ABIs
 */
function decodeWithLocalAbi(
  transaction: Transaction | null | undefined,
): DecodedTransaction | null {
  const scopedAbi = transaction
    ? ADDRESS_SCOPED_ABIS.get(transaction.address.toLowerCase())
    : undefined;
  const localAbi: Abi = scopedAbi ? [...KNOWN_ABIS, ...scopedAbi] : KNOWN_ABIS;

  return decodeTransactionWithABI(transaction, localAbi);
}

/**
 * Decode transaction with ABIs fetched from block explorer APIs
 */
async function decodeWithRemoteABI(
  tx: Transaction,
  abiResponse: ABIResponse | null | undefined,
): Promise<DecodedTransaction | null> {
  if (
    !abiResponse ||
    (!abiResponse.abi &&
      !abiResponse.implementationABI &&
      !abiResponse.proxyABI)
  ) {
    return null;
  }

  if (abiResponse.isProxy) {
    const functionSelector = tx.data.slice(0, 10);
    if (
      abiResponse.proxyABI &&
      isProxyFunctionCall(functionSelector, abiResponse.proxyABI)
    ) {
      return decodeTransactionWithABI(tx, abiResponse.proxyABI);
    } else if (abiResponse.implementationABI) {
      return decodeTransactionWithABI(tx, abiResponse.implementationABI);
    }
  }

  if (abiResponse.abi) {
    return decodeTransactionWithABI(tx, abiResponse.abi);
  }

  return null;
}

/**
 * Decode transaction using fetched ABI
 */
function decodeTransactionWithABI(
  transaction: Transaction | null | undefined,
  abi: Abi,
): DecodedTransaction | null {
  if (!transaction) {
    return null;
  }

  // Validate ABI structure
  if (!Array.isArray(abi) || abi.length === 0) {
    console.warn("Invalid ABI provided", {
      transactionAddress: transaction.address,
      abiType: typeof abi,
      abiLength: Array.isArray(abi) ? abi.length : "not array",
    });
    return null;
  }

  try {
    // Validate transaction data
    if (!transaction.data || transaction.data.length < 10) {
      console.warn("Invalid transaction data: too short or missing", {
        transactionAddress: transaction.address,
        dataLength: transaction.data?.length || 0,
      });
      return null;
    }

    // Ensure data starts with 0x
    const data = transaction.data.startsWith("0x")
      ? transaction.data
      : `0x${transaction.data}`;

    // Filter to only function ABI items
    const functionAbis = abi.filter((item) => item.type === "function");

    if (functionAbis.length === 0) {
      console.warn("No function ABIs found in provided ABI", {
        transactionAddress: transaction.address,
        abiLength: abi.length,
        abiTypes: abi.map((item) => item.type),
      });
      return null;
    }

    let decodedFunction;
    try {
      decodedFunction = decodeFunctionData({
        abi: functionAbis,
        data: data as `0x${string}`,
      });
    } catch (decodeError) {
      console.warn("Failed to decode function data with viem:", {
        error:
          decodeError instanceof Error
            ? decodeError.message
            : String(decodeError),
        transactionAddress: transaction.address,
        dataPrefix: data.slice(0, 10),
        functionAbiCount: functionAbis.length,
      });
      return null;
    }

    // Find the matching ABI item for the decoded function
    const matchingAbiItem = functionAbis.find(
      (item) => item.name === decodedFunction.functionName,
    );

    if (matchingAbiItem) {
      // Extract function signature
      const functionSignature = `${matchingAbiItem.name}(${matchingAbiItem.inputs.map((i: { type: string }) => i.type).join(",")})`;

      // viem returns args as an array in decoded.args
      const decodedArgs = decodedFunction.args as readonly unknown[];

      // Format arguments with null checks
      const args = matchingAbiItem.inputs.map(
        (input: AbiParameter, index: number) => ({
          name: input.name || `arg${index}`,
          type: input.type,
          value: formatAbiArgument(input, decodedArgs?.[index]),
        }),
      );

      return {
        functionName: matchingAbiItem.name,
        functionSignature,
        args,
      };
    }

    console.warn("No matching function found in ABI for transaction", {
      transactionAddress: transaction.address,
      dataLength: transaction.data?.length || 0,
      functionCount: functionAbis.length,
      dataPrefix: transaction.data?.slice(0, 10),
    });

    return null;
  } catch (error) {
    console.error("Error decoding transaction with ABI:", {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      transactionAddress: transaction.address,
      dataLength: transaction.data?.length || 0,
      dataPrefix: transaction.data?.slice(0, 10),
      abiLength: abi.length,
      functionAbiCount: abi.filter((item) => item.type === "function").length,
    });
    return null;
  }
}

function formatAbiArgument(
  input: AbiParameter,
  value: unknown,
): string | number | boolean | bigint {
  if (value === null || value === undefined) {
    return "";
  }

  if (isTupleParameter(input)) {
    return JSON.stringify(normalizeTupleValue(input, value));
  }

  if (input.type.startsWith("uint") || input.type.startsWith("int")) {
    return String(value);
  }

  if (input.type === "address") {
    return String(value).toLowerCase();
  }

  if (input.type === "bool") {
    return Boolean(value);
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }

  return String(value);
}

function normalizeTupleValue(
  input: TupleAbiParameter,
  value: unknown,
): Record<string, string | boolean> {
  const tupleValues = Array.isArray(value) ? value : null;
  const tupleRecord =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;

  return Object.fromEntries(
    input.components.map((component, index) => {
      const componentName = component.name || `arg${index}`;
      const componentValue = tupleValues
        ? tupleValues[index]
        : tupleRecord?.[componentName];

      if (component.type === "bool") {
        return [componentName, Boolean(componentValue)];
      }

      if (component.type === "address") {
        return [componentName, String(componentValue ?? "").toLowerCase()];
      }

      return [componentName, String(componentValue ?? "")];
    }),
  );
}

type TupleAbiParameter = AbiParameter & {
  type: "tuple";
  components: readonly AbiParameter[];
};

function isTupleParameter(input: AbiParameter): input is TupleAbiParameter {
  return input.type === "tuple" && "components" in input;
}
