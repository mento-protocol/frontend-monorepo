import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ofacList = vi.hoisted(() => ({
  getSanctionedEvmAddresses: vi.fn(),
}));

vi.mock("./ofac-list", () => ofacList);

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);

function createRequest(address?: string, ip?: string): NextRequest {
  const url = address
    ? `http://localhost:3000/api/sanctions?address=${address}`
    : "http://localhost:3000/api/sanctions";
  const headers = new Headers();
  if (ip) headers.set("x-real-ip", ip);
  return new NextRequest(url, { headers });
}

// An SDN-listed address, stored lowercase as the list loader does.
const LISTED_ADDRESS = "0x098B716B8Aaf21512996dC57EB0615e2383E2f96";
const CLEAN_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("GET /api/sanctions", () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ofacList.getSanctionedEvmAddresses.mockResolvedValue(
      new Set([LISTED_ADDRESS.toLowerCase()]),
    );
    // Re-import module each test to reset the in-memory rate limit map
    vi.resetModules();
    const mod = await import("./route");
    GET = mod.GET;
  });

  describe("input validation", () => {
    it("returns 400 when address is missing", async () => {
      const response = await GET(createRequest());
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid or missing address parameter");
    });

    it("returns 400 when address is invalid", async () => {
      const response = await GET(createRequest("not-an-address"));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid or missing address parameter");
      expect(ofacList.getSanctionedEvmAddresses).not.toHaveBeenCalled();
    });
  });

  describe("listed address", () => {
    it.each([
      ["checksummed", LISTED_ADDRESS],
      ["lowercase", LISTED_ADDRESS.toLowerCase()],
    ])("returns isSanctioned: true for a %s address", async (_, address) => {
      const response = await GET(createRequest(address, "1.2.3.4"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ isSanctioned: true });
    });

    it("reports the attempt without the address", async () => {
      await GET(createRequest(LISTED_ADDRESS, "1.2.3.4"));
      expect(sentry.captureMessage).toHaveBeenCalledWith(
        "Sanctioned address attempted connection",
        { level: "warning" },
      );
    });
  });

  describe("unlisted address", () => {
    it("returns isSanctioned: false", async () => {
      const response = await GET(createRequest(CLEAN_ADDRESS, "1.2.3.4"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ isSanctioned: false });
      expect(sentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe("no list available (fail-closed)", () => {
    it("returns 502 with isSanctioned: null", async () => {
      const error = new Error("OFAC SDN download failed: 503");
      ofacList.getSanctionedEvmAddresses.mockRejectedValue(error);

      const response = await GET(createRequest(CLEAN_ADDRESS, "1.2.3.4"));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        isSanctioned: null,
        error: "check_failed",
      });
      expect(sentry.captureException).toHaveBeenCalledWith(error, {
        extra: { context: "sanctions_check" },
      });
    });
  });

  describe("response contract", () => {
    it("never carries a degraded field", async () => {
      const bodies = [];
      for (const address of [LISTED_ADDRESS, CLEAN_ADDRESS]) {
        bodies.push(await (await GET(createRequest(address))).json());
      }
      ofacList.getSanctionedEvmAddresses.mockRejectedValue(new Error("down"));
      bodies.push(await (await GET(createRequest(CLEAN_ADDRESS))).json());

      for (const body of bodies) {
        expect(body).not.toHaveProperty("degraded");
      }
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding rate limit", async () => {
      const ip = "10.0.0.1";
      const responses = [];

      for (let i = 0; i < 62; i++) {
        responses.push(await GET(createRequest(CLEAN_ADDRESS, ip)));
      }

      const lastResponse = responses[responses.length - 1]!;
      expect(lastResponse.status).toBe(429);
      const body = await lastResponse.json();
      expect(body.error).toBe("Too many requests");
    });
  });
});
