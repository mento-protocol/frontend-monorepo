import { getAddress, isAddress } from "@ethersproject/address";
import { type Address } from "viem";
import { logger } from "./logger";

export function isValidAddress(address: unknown): address is string {
  // Need to catch because ethers' isAddress throws in some cases (bad checksum)
  try {
    if (typeof address !== "string" || address.trim() === "") {
      return false;
    }
    const isValid = isAddress(address);
    return !!isValid;
  } catch (error) {
    logger.warn("Invalid address", error, address);
    return false;
  }
}

export function validateAddress(
  address: unknown,
  context: string,
): asserts address is string {
  if (!isValidAddress(address)) {
    const errorMsg = `Invalid address for ${context}: ${address}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

export function normalizeAddress(address: string | unknown) {
  validateAddress(address, "normalize");
  return getAddress(address);
}

export function shortenAddress(address: string | unknown, capitalize = true) {
  validateAddress(address, "shorten");
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

export function areAddressesEqual(a1: string | unknown, a2: string | unknown) {
  validateAddress(a1, "compare");
  validateAddress(a2, "compare");
  return getAddress(a1) === getAddress(a2);
}

export function trimLeading0x(input: string) {
  return input.startsWith("0x") ? input.substring(2) : input;
}

export function ensureLeading0x(input: string) {
  return input.startsWith("0x") ? input : `0x${input}`;
}

export function toViemAddress(address: unknown): Address | undefined {
  return isValidAddress(address) ? (address as Address) : undefined;
}
