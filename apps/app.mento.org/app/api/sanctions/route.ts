import { env } from "@/env.mjs";
import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

const CHAINALYSIS_API_BASE = "https://public.chainalysis.com/api/v1/address";
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
  // Prefer Vercel's verified header, fall back to rightmost x-forwarded-for
  // (rightmost is the one added by the closest trusted proxy)
  const vercelIp = request.headers.get("x-real-ip");
  if (vercelIp) return vercelIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1]!.trim();
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

  try {
    const response = await fetch(`${CHAINALYSIS_API_BASE}/${address}`, {
      headers: {
        "X-API-KEY": env.CHAINALYSIS_API_KEY,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      Sentry.captureException(
        new Error(`Chainalysis API error: ${response.status}`),
        { extra: { status: response.status } },
      );
      return NextResponse.json(
        { isSanctioned: null, error: "check_failed" },
        { status: 502 },
      );
    }

    const data = await response.json();
    const isSanctioned =
      Array.isArray(data.identifications) && data.identifications.length > 0;

    if (isSanctioned) {
      Sentry.captureMessage("Sanctioned address attempted connection", {
        level: "warning",
        extra: { address },
      });
    }

    return NextResponse.json({ isSanctioned });
  } catch (error) {
    Sentry.captureException(error, {
      extra: { context: "sanctions_check" },
    });
    return NextResponse.json(
      { isSanctioned: null, error: "check_failed" },
      { status: 502 },
    );
  }
}
