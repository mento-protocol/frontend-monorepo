import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { env } from "../../../env.mjs";
import { ContractInfo } from "../types";

interface ContractSourceCodeResponse {
  status: string;
  result: Array<{
    ContractName: string;
    SourceCode: string;
    ABI: string;
    CompilerVersion: string;
    OptimizationUsed: string;
    Runs: string;
    ConstructorArguments: string;
    EVMVersion: string;
    Library: string;
    LicenseType: string;
    Proxy: string;
    Implementation: string;
    SwarmSource: string;
  }>;
  message?: string;
}

/**
 * Fetch contract source code from external APIs
 */
async function fetchSourceCode(
  address: string,
  source: "celoscan" | "blockscout",
  apiKey?: string,
): Promise<ContractSourceCodeResponse | null> {
  try {
    let url: string;

    if (source === "celoscan") {
      // Celoscan requires an API key - use Etherscan V2 API (Celo chain ID: 42220)
      if (apiKey) {
        url = `https://api.etherscan.io/v2/api?chainid=42220&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
      } else {
        // Fallback to old Celoscan API (will fail without API key)
        url = `https://api.celoscan.io/api?module=contract&action=getsourcecode&address=${address}`;
      }
    } else {
      // Blockscout doesn't require an API key
      url = `https://celo.blockscout.com/api?module=contract&action=getsourcecode&address=${address}`;
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MentoGovernance/1.0",
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.status === "1" && data.result && data.result.length > 0) {
        return data;
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

/**
 * Extract contract name from source code response
 */
function extractContractName(
  response: ContractSourceCodeResponse,
  source: "celoscan" | "blockscout",
): ContractInfo | null {
  const result = response.result[0];

  if (!result || !result.ContractName) {
    return null;
  }

  const contractInfo: ContractInfo = {
    name: result.ContractName,
    source,
  };

  // Check if this is a proxy contract
  if (result.Proxy === "1" && result.Implementation) {
    contractInfo.isProxy = true;
    contractInfo.implementationAddress = result.Implementation;
  }

  return contractInfo;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const addressParam = searchParams.get("address");

    if (!addressParam) {
      return NextResponse.json(
        { error: "Address parameter is required" },
        { status: 400 },
      );
    }

    const address = addressParam.toLowerCase();

    if (!isAddress(address)) {
      return NextResponse.json(
        { error: "Invalid address format" },
        { status: 400 },
      );
    }

    // Skip contract info fetching for zero address (empty transactions)
    if (address === "0x0000000000000000000000000000000000000000") {
      return NextResponse.json(
        {
          error: "No contract info available for zero address",
          address,
        },
        { status: 404 },
      );
    }

    // Get API key from environment (only needed for Celoscan)
    const apiKey = env.NEXT_PUBLIC_ETHERSCAN_API_KEY;

    // Try Celoscan first (requires API key)
    let sourceCodeResponse = await fetchSourceCode(address, "celoscan", apiKey);
    let source: "blockscout" | "celoscan" = "celoscan";

    // Fallback to Blockscout (no API key required)
    if (!sourceCodeResponse) {
      sourceCodeResponse = await fetchSourceCode(address, "blockscout");
      source = "blockscout";
    }

    if (!sourceCodeResponse) {
      return NextResponse.json(
        { error: "Contract not found or not verified" },
        { status: 404 },
      );
    }

    const contractInfo = extractContractName(sourceCodeResponse, source);

    if (!contractInfo) {
      return NextResponse.json(
        { error: "Unable to extract contract name" },
        { status: 404 },
      );
    }

    return NextResponse.json(contractInfo);
  } catch (error) {
    console.error("Error fetching contract info:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
