import { NextRequest, NextResponse } from "next/server";

// Map chain IDs to their RPC URLs
const CHAIN_RPC_URLS: Record<number, string> = {
  42220: "https://forno.celo.org", // Celo Mainnet
  44787: "https://alfajores-forno.celo-testnet.org", // Celo Alfajores Testnet
  62320: "https://forno.dango.celo-testnet.org", // Celo Dango Testnet
  1101: "https://forno.baklava.celo-testnet.org", // Celo Baklava Testnet
  1000: "https://forno.celo-sepolia.celo-testnet.org", // Celo Sepolia Testnet (deprecated)
  11142220: "https://forno.celo-sepolia.celo-testnet.org", // Celo Sepolia Testnet
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Get chain ID from query params or use Celo mainnet as default
    const { searchParams } = new URL(request.url);
    const chainIdParam = searchParams.get("chainId");
    const chainId = chainIdParam ? parseInt(chainIdParam, 10) : 42220;

    const rpcUrl = CHAIN_RPC_URLS[chainId];

    if (!rpcUrl) {
      return NextResponse.json(
        { error: `No RPC URL configured for chain ID ${chainId}` },
        { status: 400 },
      );
    }

    // Forward the RPC request to the actual endpoint
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("RPC proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
