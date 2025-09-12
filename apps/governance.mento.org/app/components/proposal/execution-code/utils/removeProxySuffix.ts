/**
 * Removes "Proxy" suffix from contract names for cleaner display
 * @param contractName - The contract name to process
 * @returns The contract name with "Proxy" suffix removed if it exists
 */
export function removeProxySuffix(contractName: string | undefined): string {
  if (!contractName) return "";

  // Remove "Proxy" suffix (case-insensitive) if the name ends with it
  return contractName.replace(/Proxy$/i, "");
}
