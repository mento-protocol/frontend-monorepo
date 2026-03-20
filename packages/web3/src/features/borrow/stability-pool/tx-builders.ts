import { encodeFunctionData } from "viem";
import type { CallParams } from "../types";
import { stabilityPoolAbi } from "./abi";

/**
 * Builds a CallParams for depositing into the Stability Pool (provideToSP).
 */
export function buildSpDeposit(
  spAddress: string,
  amount: bigint,
  doClaim: boolean,
): CallParams {
  const data = encodeFunctionData({
    abi: stabilityPoolAbi,
    functionName: "provideToSP",
    args: [amount, doClaim],
  });

  return { to: spAddress, data, value: "0x0" };
}

/**
 * Builds a CallParams for withdrawing from the Stability Pool (withdrawFromSP).
 */
export function buildSpWithdraw(
  spAddress: string,
  amount: bigint,
  doClaim: boolean,
): CallParams {
  const data = encodeFunctionData({
    abi: stabilityPoolAbi,
    functionName: "withdrawFromSP",
    args: [amount, doClaim],
  });

  return { to: spAddress, data, value: "0x0" };
}
