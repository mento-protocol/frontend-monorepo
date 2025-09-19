import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { env } from "../../../env.mjs";
import { ContractInfo } from "../types";
import {
  fetchFromBlockchainExplorer,
  BlockchainExplorerSource,
  ContractSourceCodeResponse,
} from "../services/blockchain-explorer-service";

/**
 * Extract contract name from source code response
 */
function extractContractName(
  response: ContractSourceCodeResponse,
  source: BlockchainExplorerSource,
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
    const etherscanApiKey = env.ETHERSCAN_API_KEY;

    // Try Celoscan first
    let source: BlockchainExplorerSource = "celoscan";
    let sourceCodeResponse =
      await fetchFromBlockchainExplorer<ContractSourceCodeResponse>(
        "getsourcecode",
        address,
        source,
        etherscanApiKey,
      );

    // Fallback to Blockscout
    if (!sourceCodeResponse) {
      console.log(
        `Etherscan: No source code found for ${address}, falling back to Blockscout API`,
      );
      sourceCodeResponse =
        await fetchFromBlockchainExplorer<ContractSourceCodeResponse>(
          "getsourcecode",
          address,
          "blockscout",
        );
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
