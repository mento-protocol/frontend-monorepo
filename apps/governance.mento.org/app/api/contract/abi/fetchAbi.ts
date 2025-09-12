import { env } from "@/env.mjs";
import { Abi, Address } from "viem";

// Function to fetch ABI from external APIs
export async function fetchAbi(
  address: Address,
  source: "blockscout" | "celoscan",
  apiKey?: string,
): Promise<Abi | null> {
  try {
    let url: string;

    if (source === "blockscout") {
      // Blockscout doesn't require an API key
      url = `${env.NEXT_PUBLIC_BLOCKSCOUT_API_URL}?module=contract&action=getabi&address=${address}`;
    } else {
      // Celoscan requires an API key - use Etherscan V2 API (Celo chain ID: 42220)
      if (!apiKey) throw new Error("API key is required for Celoscan");
      url = `${env.NEXT_PUBLIC_ETHERSCAN_API_URL}?chainid=42220&module=contract&action=getabi&address=${address}&apikey=${apiKey}`;
    }

    const response = await fetch(url);

    if (response.ok) {
      const data = await response.json();
      if (data.status === "1" && data.result) {
        return JSON.parse(data.result);
      } else {
        console.warn(
          `${source} API returned status ${data.status}: ${data.message || "Unknown error"}`,
        );
      }
    } else {
      console.warn(
        `${source} API returned ${response.status}: ${response.statusText}`,
      );
    }
    return null;
  } catch (error) {
    console.warn(`${source} API failed for address ${address}:`, error);
    return null;
  }
}
