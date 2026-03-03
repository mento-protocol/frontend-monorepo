import type { Config } from "wagmi";
import {
  estimateGas,
  sendTransaction,
  waitForTransactionReceipt,
} from "wagmi/actions";
import type { Address, Hex, TransactionReceipt } from "viem";
import type { CallParams } from "../types";

const DEFAULT_GAS_HEADROOM = 0.25;

/**
 * Sends an SDK-built transaction through wagmi, applying a gas headroom buffer.
 */
export async function sendSdkTransaction(
  wagmiConfig: Config,
  callParams: CallParams,
  gasHeadroom: number = DEFAULT_GAS_HEADROOM,
): Promise<Hex> {
  const txRequest = {
    to: callParams.to as Address,
    data: callParams.data as Hex,
    value: BigInt(callParams.value || 0),
  };

  try {
    const gasEstimate = await estimateGas(wagmiConfig, txRequest);
    const gasLimit =
      gasEstimate + BigInt(Math.ceil(Number(gasEstimate) * gasHeadroom));

    return await sendTransaction(wagmiConfig, {
      ...txRequest,
      gas: gasLimit,
    });
  } catch (error) {
    throw normalizeTxError(error);
  }
}

/**
 * Waits for a transaction to be mined and returns the receipt.
 * Uses multiple confirmations to ensure the sequencer has fully processed
 * the transaction before proceeding (prevents nonce-too-low errors in
 * multi-step flows on L2s).
 */
export async function waitForTx(
  wagmiConfig: Config,
  hash: Hex,
  confirmations: number = 3,
): Promise<TransactionReceipt> {
  return waitForTransactionReceipt(wagmiConfig, { hash, confirmations });
}

function normalizeTxError(error: unknown): Error {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  if (/user\s+rejected|denied\s+transaction|request\s+rejected/i.test(message))
    return new Error("Transaction rejected by user");

  if (/reverted/i.test(message)) {
    const reason = extractRevertReason(message);
    return new Error(`Transaction reverted: ${reason}`);
  }

  if (/insufficient\s+funds/i.test(message))
    return new Error("Insufficient funds for transaction");

  return error instanceof Error ? error : new Error(message);
}

function extractRevertReason(message: string): string {
  const match = message.match(
    /reason:\s*(.+?)(?:\n|$)|reverted with reason string '(.+?)'/i,
  );
  return match?.[1] ?? match?.[2] ?? "unknown reason";
}
