import type { Config } from "wagmi";
import {
  estimateGas,
  getAccount,
  sendTransaction,
  waitForTransactionReceipt,
} from "wagmi/actions";
import { BORROWER_OPERATIONS_ABI } from "@mento-protocol/mento-sdk/dist/core/abis";
import {
  decodeErrorResult,
  isHex,
  parseAbi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import type { CallParams } from "../types";

const DEFAULT_GAS_HEADROOM = 0.25;
const MAX_ERROR_WALK_DEPTH = 8;
const REVERT_REASON_MAP: Record<string, string> = {
  DebtBelowMin: "Debt is below protocol minimum",
  ERC20InsufficientAllowance: "Token allowance is too low for this operation",
  ERC20InsufficientBalance: "Token balance is too low for this operation",
  ICRBelowMCRPlusBCR:
    "Collateral ratio is too low after applying the branch buffer",
  ICRBelowMCR: "Collateral ratio is too low for this debt amount",
  InterestRateTooHigh: "Interest rate is above the allowed maximum",
  InterestRateTooLow: "Interest rate is below the protocol minimum",
  IsShutDown: "Borrowing is currently shut down",
  TCRBelowCCR:
    "This operation would push total collateral ratio below the critical threshold",
  TroveExists: "Position already exists for this owner/index pair",
  UpfrontFeeTooHigh:
    "Upfront fee exceeded your max fee tolerance. Retry with a higher max fee",
};
const ERC20_CUSTOM_ERRORS_ABI = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidSpender(address spender)",
]);
const REVERT_DATA_REGEX = /0x[a-fA-F0-9]{8,}/g;

/**
 * Sends an SDK-built transaction through wagmi, applying a gas headroom buffer.
 */
export async function sendSdkTransaction(
  wagmiConfig: Config,
  callParams: CallParams,
  gasHeadroom: number = DEFAULT_GAS_HEADROOM,
  account?: string,
): Promise<Hex> {
  const connectedAccount = account ?? getAccount(wagmiConfig).address;
  const txRequest = {
    ...(connectedAccount ? { account: connectedAccount as Address } : {}),
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
    throw normalizeTxError(error, txRequest.data);
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

function normalizeTxError(error: unknown, txData?: Hex): Error {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const details = extractNestedErrorDetails(error);
  const causeMessage = details[0] ?? "";
  const combinedMessage =
    causeMessage && !message.includes(causeMessage)
      ? `${message}\n${details.join("\n")}`
      : message;

  if (
    /user\s+rejected|denied\s+transaction|request\s+rejected/i.test(
      combinedMessage,
    )
  )
    return new Error("Transaction rejected by user");

  if (
    /reverted|execution reverted|always failing transaction/i.test(
      combinedMessage,
    )
  ) {
    const reason = extractRevertReason(error, combinedMessage, txData);
    return new Error(`Transaction reverted: ${reason}`);
  }

  if (/insufficient\s+funds/i.test(combinedMessage))
    return new Error("Insufficient funds for transaction");

  return error instanceof Error ? error : new Error(message);
}

function extractRevertReason(
  error: unknown,
  message: string,
  txData?: Hex,
): string {
  const details = extractNestedErrorDetails(error);
  const revertDataCandidates = new Set<Hex>();

  if (txData) revertDataCandidates.add(txData);
  for (const detail of [message, ...details]) {
    for (const match of detail.matchAll(REVERT_DATA_REGEX)) {
      const candidate = match[0] as Hex;
      if (isHex(candidate) && candidate.length >= 10) {
        revertDataCandidates.add(candidate);
      }
    }
  }

  const deepCandidates = extractHexCandidatesFromObject(error);
  for (const candidate of deepCandidates) {
    if (candidate.length >= 10) {
      revertDataCandidates.add(candidate);
    }
  }

  for (const data of revertDataCandidates) {
    const decoded = decodeKnownCustomError(data);
    if (decoded) return decoded;
  }

  const reasonMatch = `${message}\n${details.join("\n")}`.match(
    /reason:\s*(.+?)(?:\n|$)|reverted with reason string '(.+?)'|execution reverted:?\s*([^\n]+)/i,
  );
  const customErrorMatch = message.match(
    /custom error ['"]?([A-Za-z0-9_.:]+)['"]?/i,
  );
  const rawReason =
    reasonMatch?.[1] ??
    reasonMatch?.[2] ??
    reasonMatch?.[3] ??
    customErrorMatch?.[1];

  if (!rawReason) {
    const detail = summarizeUsefulDetail(details);
    return detail ? `unknown reason (${detail})` : "unknown reason";
  }

  if (/for an unknown reason|unknown reason/i.test(rawReason)) {
    const detail = summarizeUsefulDetail(details);
    return detail ? `unknown reason (${detail})` : "unknown reason";
  }

  const normalizedCode = normalizeRevertCode(rawReason);
  return REVERT_REASON_MAP[normalizedCode] ?? rawReason.trim();
}

function decodeKnownCustomError(data: Hex): string | null {
  try {
    const decoded = decodeErrorResult({ abi: BORROWER_OPERATIONS_ABI, data });
    return mapErrorCode(decoded.errorName);
  } catch {
    // Try ERC20 custom errors when tx reverts at token layer.
  }

  try {
    const decoded = decodeErrorResult({ abi: ERC20_CUSTOM_ERRORS_ABI, data });
    return mapErrorCode(decoded.errorName);
  } catch {
    return null;
  }
}

function mapErrorCode(errorName: string): string {
  const normalizedCode = normalizeRevertCode(errorName);
  return REVERT_REASON_MAP[normalizedCode] ?? normalizedCode;
}

function normalizeRevertCode(reason: string): string {
  const withoutArgs = reason.trim().replace(/\(.*/, "");
  const segments = withoutArgs.split(/[:.]/).filter(Boolean);
  return segments[segments.length - 1] ?? withoutArgs;
}

function extractNestedErrorDetails(error: unknown): string[] {
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (
    current &&
    typeof current === "object" &&
    !seen.has(current) &&
    depth < MAX_ERROR_WALK_DEPTH
  ) {
    seen.add(current);
    const obj = current as Record<string, unknown>;

    for (const key of ["shortMessage", "details", "message"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim().length > 0) {
        details.push(value.trim());
      }
    }

    current = obj.cause;
    depth++;
  }

  return [...new Set(details)];
}

function extractHexCandidatesFromObject(error: unknown): Hex[] {
  const hexes = new Set<Hex>();
  const seen = new Set<unknown>();

  function visit(value: unknown, depth: number): void {
    if (depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (isHex(value) && value.length >= 10) {
        hexes.add(value as Hex);
      }
      for (const match of value.matchAll(REVERT_DATA_REGEX)) {
        const candidate = match[0] as Hex;
        if (isHex(candidate) && candidate.length >= 10) {
          hexes.add(candidate);
        }
      }
      return;
    }

    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const obj = value as Record<string, unknown>;

    for (const key of ["data", "error", "cause", "details", "message"]) {
      if (key in obj) visit(obj[key], depth + 1);
    }
  }

  visit(error, 0);
  return [...hexes];
}

function summarizeUsefulDetail(details: string[]): string | null {
  for (const detail of details) {
    if (/version:\s*viem/i.test(detail)) continue;
    if (/estimate gas|send transaction/i.test(detail)) continue;
    const normalized = detail.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) continue;
    if (/execution reverted for an unknown reason\.?/i.test(normalized))
      continue;
    return normalized.slice(0, 180);
  }
  return null;
}
