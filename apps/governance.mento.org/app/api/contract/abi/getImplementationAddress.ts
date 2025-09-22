import { Address, isAddress, PublicClient } from "viem";

// Function to get implementation address from proxy contract
export async function getImplementationAddress(
  blockchainClient: PublicClient,
  proxyAddress: Address,
): Promise<Address | null> {
  try {
    // Try different common proxy patterns
    const proxyMethods = [
      "implementation()",
      "_implementation()",
      "getImplementation()",
      "_getImplementation()",
    ];

    for (const method of proxyMethods) {
      try {
        const methodName = method.replace("()", "");
        const result = await blockchainClient.readContract({
          address: proxyAddress,
          abi: [
            {
              name: methodName,
              type: "function",
              stateMutability: "view",
              inputs: [],
              outputs: [{ type: "address" }],
            },
          ],
          functionName: methodName,
          args: [],
        });

        if (result && isAddress(result as string)) {
          return result as Address;
        }
      } catch {
        // Method doesn't exist, try next one
        continue;
      }
    }

    return null;
  } catch (error) {
    console.warn(
      `Failed to get implementation address for proxy ${proxyAddress}:`,
      error,
    );
    return null;
  }
}
