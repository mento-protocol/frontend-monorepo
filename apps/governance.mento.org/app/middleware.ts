import { Celo, GovernorABI } from "@repo/web3";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Address, ChainContract, createPublicClient, http } from "viem";

export const matcher = ["/proposals/:id*"];

export const IS_PROD = process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
export const IS_DEV = process.env.NEXT_PUBLIC_VERCEL_ENV === "development";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!IS_PROD && !IS_DEV) return NextResponse.next();

  if (pathname.startsWith("/proposals")) {
    const [, , id] = pathname.split("/");
    if (id) {
      // Query Celo
      const publicClient = createPublicClient({
        chain: Celo,
        transport: http(),
      });

      return new Promise((resolve) => {
        try {
          const parsedId = BigInt(id);
          const governor = Celo.contracts?.MentoGovernor as ChainContract;
          const governorAddress = governor.address as Address;

          publicClient
            .readContract({
              address: governorAddress,
              abi: GovernorABI,
              functionName: "proposals",
              args: [BigInt(parsedId)],
            })
            .then((proposal) => {
              if (proposal) {
                resolve(NextResponse.next());
              } else {
                const url = new URL("/", request.url);
                console.log("Proposal not found, redirecting");
                resolve(NextResponse.redirect(url.origin));
              }
            })
            .catch(() => {
              console.log("Proposal not found on Celo chain, redirecting");
              const url = new URL("/", request.url);
              resolve(NextResponse.redirect(url.origin));
            });
        } catch {
          console.log("Proposal ID not found, redirecting");
          const url = new URL("/", request.url);
          resolve(NextResponse.redirect(url.origin));
        }
      });
    } else {
      console.log("Proposal ID not found, redirecting");
      const url = new URL("/", request.url);
      return NextResponse.redirect(url.origin);
    }
  }
}
