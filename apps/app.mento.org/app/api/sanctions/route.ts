import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getSanctionedEvmAddresses } from "./ofac-list";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

const requestCounts = new Map<string, { count: number; resetAt: number }>();

// Purge expired entries every 5 minutes to prevent unbounded growth
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of requestCounts) {
        if (now > entry.resetAt) {
          requestCounts.delete(key);
        }
      }
    },
    5 * 60 * 1000,
  );
}

function getClientIp(request: NextRequest): string {
  // On Vercel (production), x-real-ip is set by the platform and is trustworthy
  const vercelIp = request.headers.get("x-real-ip");
  if (vercelIp) return vercelIp.trim();

  // Fallback: x-forwarded-for. Leftmost = original client (but spoofable),
  // rightmost = nearest proxy. We use leftmost as a best-effort for non-Vercel.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[0]!.trim();
  }

  return "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const address = request.nextUrl.searchParams.get("address");

  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: "Invalid or missing address parameter" },
      { status: 400 },
    );
  }

  let sanctionedAddresses: ReadonlySet<string>;
  try {
    sanctionedAddresses = await getSanctionedEvmAddresses();
  } catch (error) {
    // No verified list has been loaded, so there is no verdict to give.
    Sentry.captureException(error, {
      extra: { context: "sanctions_check" },
    });
    return NextResponse.json(
      { isSanctioned: null, error: "check_failed" },
      { status: 502 },
    );
  }

  const isSanctioned = sanctionedAddresses.has(address.toLowerCase());

  if (isSanctioned) {
    Sentry.captureMessage("Sanctioned address attempted connection", {
      level: "warning",
    });
  }

  return NextResponse.json({ isSanctioned });
}
