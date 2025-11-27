import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  AbiFunction,
  PublicClient,
  type Address,
} from "viem";
import { celo } from "viem/chains";
import { validateAddress } from "@repo/web3";
import { getImplementationAddress } from "./getImplementationAddress";
import {
  fetchAbi,
  BlockchainExplorerSource,
} from "../services/blockchain-explorer-service";
import { env } from "@/env.mjs";
import { isAbi } from "./isAbi";

// Create a public client for Celo mainnet
const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
}) as PublicClient;

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

    try {
      validateAddress(address, "contract ABI API");
    } catch (error) {
      console.error("Invalid address format: %s", address, error);
      return NextResponse.json(
        { error: "Invalid address format" },
        { status: 400 },
      );
    }

    // Skip ABI fetching for zero address (empty transactions)
    if (address === "0x0000000000000000000000000000000000000000") {
      return NextResponse.json(
        {
          error: "No ABI available for zero address",
          address,
        },
        { status: 404 },
      );
    }

    // Get API key from environment (only needed for Celoscan)
    const etherscanApiKey = env.ETHERSCAN_API_KEY;

    // Try Celoscan first
    let abiSource: BlockchainExplorerSource = "celoscan";
    let abi = await fetchAbi(address, abiSource, etherscanApiKey);

    // Fallback to Blockscout
    if (!abi) {
      console.log(
        `Etherscan: No ABI found for ${address}, falling back to Blockscout API`,
      );
      abiSource = "blockscout";
      abi = await fetchAbi(address, abiSource);
    }

    if (abi && isAbi(abi)) {
      const isProxy = abi.some((item: unknown) => {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          "name" in item
        ) {
          const abiFunction = item as AbiFunction;
          return (
            abiFunction.name &&
            (abiFunction.name.includes("Implementation") ||
              abiFunction.name.includes("_getImplementation") ||
              abiFunction.name === "implementation")
          );
        }
        return false;
      });

      if (isProxy) {
        const implementationAddress = await getImplementationAddress(
          publicClient,
          address as Address,
        );

        if (implementationAddress) {
          const implementationABI = await fetchAbi(
            implementationAddress,
            abiSource,
            abiSource === "celoscan" ? etherscanApiKey : undefined,
          );

          return NextResponse.json({
            source: abiSource,
            proxyABI: abi,
            implementationABI,
            proxyAddress: address,
            implementationAddress,
            isProxy: true,
          });
        } else {
          // Return proxy ABI only if we can't get implementation
          return NextResponse.json({
            source: abiSource,
            proxyABI: abi,
            implementationABI: null,
            proxyAddress: address,
            implementationAddress: null,
            isProxy: true,
          });
        }
      }

      return NextResponse.json({
        source: abiSource,
        abi,
        address,
      });
    }

    // No ABI found
    return NextResponse.json(
      {
        error: "Contract ABI not found or contract not verified",
        address,
        source: abiSource,
      },
      { status: 404 },
    );
  } catch (error) {
    console.error("Error in ABI endpoint:", error);
    return NextResponse.json(
      {
        error: "Internal server error while fetching contract ABI",
      },
      { status: 500 },
    );
  }
}
