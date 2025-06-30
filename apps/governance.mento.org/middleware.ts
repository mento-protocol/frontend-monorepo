import { Celo } from "@/lib/config/chains";
import { GovernorABI } from "@/lib/abi/Governor";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { env } from "@/env.mjs";

/**
 * NOTE: This middleware **must** live at the project root (not inside `app/`) so
 * that Next.js treats it as middleware rather than a route segment file. Having
 * the file in `app/` triggers a deprecation warning:
 *   "Invalid page configuration – Page config in app/middleware.ts is deprecated"
 *
 * Moving the file here resolves the warning while preserving the original
 * behaviour.
 */

export const config = {
  matcher: ["/proposals/:id*"],
};

export const IS_PROD = env.NEXT_PUBLIC_VERCEL_ENV === "production";
export const IS_DEV = env.NEXT_PUBLIC_VERCEL_ENV === "development";
export const IS_PREVIEW = env.NEXT_PUBLIC_VERCEL_ENV === "preview";

export function middleware(request: NextRequest, _event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  if (!IS_PROD && !IS_DEV && !IS_PREVIEW) return NextResponse.next();

  if (pathname.startsWith("/proposals")) {
    const [, , id] = pathname.split("/");
    if (id) {
      // Query Celo chain for the proposal to ensure it exists. Redirect to home
      // page if not found.
      const publicClient = createPublicClient({
        chain: Celo,
        transport: http(),
      });

      return new Promise<NextResponse>((resolve) => {
        try {
          const parsedId = BigInt(id);

          publicClient
            .readContract({
              address: Celo.contracts.MentoGovernor.address,
              abi: GovernorABI,
              functionName: "proposals",
              args: [parsedId],
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
          console.log("Invalid proposal ID, redirecting");
          const url = new URL("/", request.url);
          resolve(NextResponse.redirect(url.origin));
        }
      });
    }

    // No id => redirect to homepage
    const url = new URL("/", request.url);
    return NextResponse.redirect(url.origin);
  }

  return NextResponse.next();
}
