import {
  TokenSymbol,
  getContractAddress,
  getTokenAddress,
} from "@mento-protocol/mento-sdk";
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";

/**
 * Builds the `approve(Router, amountInWei)` transaction request the user signs
 * before a swap. Shared by useApproveTransaction (submission) and
 * useGasEstimation (fee estimation) so both estimate/submit the same calldata.
 */
export function buildApproveTransactionRequest(
  chainId: number,
  tokenInSymbol: TokenSymbol,
  amountInWei: string,
): { to: Address; data: Hex } {
  const tokenInAddr = getTokenAddress(chainId, tokenInSymbol);
  if (!tokenInAddr) {
    throw new Error(
      `${tokenInSymbol} token address not found on chain ${chainId}`,
    );
  }

  const spender = getContractAddress(chainId, "Router");

  const data = encodeFunctionData({
    abi: [
      {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
      },
    ],
    functionName: "approve",
    args: [spender as Address, BigInt(amountInWei)],
  });

  return { to: tokenInAddr as Address, data };
}
