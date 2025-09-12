import { NextRequest, NextResponse } from "next/server";
import {
  isAddress,
  createPublicClient,
  http,
  AbiFunction,
  PublicClient,
} from "viem";
import { celo } from "viem/chains";
import { getImplementationAddress } from "./getImplementationAddress";
import { fetchAbi } from "./fetchAbi";
import { env } from "../../../env.mjs";
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

    if (!isAddress(address)) {
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
    const apiKey = env.NEXT_PUBLIC_ETHERSCAN_API_KEY;

    // Try Blockscout first (no API key required)
    let abiSource = "blockscout";
    let abi = await fetchAbi(address, "blockscout");

    // Fallback to Celoscan (requires API key)
    if (!abi) {
      abiSource = "celoscan";
      abi = await fetchAbi(address, "celoscan", apiKey);
    }

    if (abi && isAbi(abi)) {
      const isProxy = abi.some((item) => {
        if (item.type === "function" && "name" in item) {
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
          address,
        );

        if (implementationAddress) {
          let implementationSource;
          let implementationABI = await fetchAbi(
            implementationAddress,
            "blockscout",
          );

          if (!implementationABI) {
            implementationABI = await fetchAbi(
              implementationAddress,
              "celoscan",
              apiKey,
            );
            implementationSource = "celoscan";
          } else {
            implementationSource = "blockscout";
          }

          return NextResponse.json({
            source: implementationSource,
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
