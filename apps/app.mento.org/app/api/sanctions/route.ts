import { env } from "@/env.mjs";
import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

const CHAINALYSIS_API_BASE = "https://public.chainalysis.com/api/v1/address";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const FETCH_TIMEOUT_MS = 10_000;

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

function failClosed() {
  return NextResponse.json(
    { isSanctioned: null, error: "check_failed" },
    { status: 502 },
  );
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

  if (!env.CHAINALYSIS_API_KEY) {
    Sentry.captureException(new Error("CHAINALYSIS_API_KEY is not configured"));
    return failClosed();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${CHAINALYSIS_API_BASE}/${address}`, {
      headers: {
        "X-API-KEY": env.CHAINALYSIS_API_KEY,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      Sentry.captureException(
        new Error(`Chainalysis API error: ${response.status}`),
        { extra: { status: response.status } },
      );
      return failClosed();
    }

    const data = await response.json();

    // Validate response shape — fail closed on unexpected payloads
    if (
      !data ||
      typeof data !== "object" ||
      !Array.isArray(data.identifications)
    ) {
      Sentry.captureException(
        new Error("Chainalysis API returned unexpected response shape"),
        { extra: { dataKeys: data ? Object.keys(data) : null } },
      );
      return failClosed();
    }

    const isSanctioned = data.identifications.length > 0;

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
    return failClosed();
  } finally {
    clearTimeout(timeout);
  }
}
