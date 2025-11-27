import { getAddress } from "@ethersproject/address";
import { type Address, isAddress } from "viem";
import { logger } from "./logger";

// To declare once and reuse everywhere
export const isValidAddress = isAddress;

export function validateAddress(
  address: string | undefined,
  context: string,
): asserts address is string {
  if (!isValidAddress(address as string)) {
    const errorMsg = `Invalid address for ${context}: ${address}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

export function normalizeAddress(address: string) {
  validateAddress(address, "normalizeAddress");
  return getAddress(address);
}

export function shortenAddress(address: string, capitalize = true) {
  validateAddress(address, "shortenAddress");
  const normalizedAddress = normalizeAddress(address);
  const addressStr = typeof address === "string" ? address : normalizedAddress;

  const start = normalizedAddress.substring(0, 6);
  const end = normalizedAddress.substring(addressStr.length - 4);

  const shortened = `${start}...${end}`;
  return capitalize ? capitalizeAddress(shortened) : shortened;
}

export function capitalizeAddress(address: string) {
  return "0x" + address.substring(2).toUpperCase();
}

export function areAddressesEqual(a1: string, a2: string) {
  validateAddress(a1, "areAddressesEqual");
  validateAddress(a2, "areAddressesEqual");
  return getAddress(a1) === getAddress(a2);
}

export function trimLeading0x(input: string) {
  return input.startsWith("0x") ? input.substring(2) : input;
}

export function ensureLeading0x(input: string) {
  return input.startsWith("0x") ? input : `0x${input}`;
}

export function toViemAddress(address: string): Address | undefined {
  return isValidAddress(address) ? address : undefined;
}
