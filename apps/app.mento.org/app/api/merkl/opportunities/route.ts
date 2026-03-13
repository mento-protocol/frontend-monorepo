import { NextRequest, NextResponse } from "next/server";

const MERKL_API_BASE = "https://api.merkl.xyz/v4";
const ALLOWED_PARAMS = new Set(["chainId", "mainProtocolId"]);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // Only forward known parameters to Merkl
  const params = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (ALLOWED_PARAMS.has(key)) {
      params.set(key, value);
    }
  }

  const url = `${MERKL_API_BASE}/opportunities?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 300 }, // cache for 5 minutes on the edge
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Merkl API error: ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
