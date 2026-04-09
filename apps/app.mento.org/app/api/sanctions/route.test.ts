import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/env.mjs", () => ({
  env: { CHAINALYSIS_API_KEY: "test-api-key" },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

function createRequest(address?: string, ip?: string): NextRequest {
  const url = address
    ? `http://localhost:3000/api/sanctions?address=${address}`
    : "http://localhost:3000/api/sanctions";
  const headers = new Headers();
  if (ip) headers.set("x-real-ip", ip);
  return new NextRequest(url, { headers });
}

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("GET /api/sanctions", () => {
  let GET: (request: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.restoreAllMocks();
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
    });
  });

  describe("clean address", () => {
    it("returns isSanctioned: false for a clean address", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ identifications: [] }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await GET(createRequest(VALID_ADDRESS, "1.2.3.4"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.isSanctioned).toBe(false);
      expect(body.error).toBeUndefined();
    });

    it("forwards X-API-KEY header to Chainalysis", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ identifications: [] }),
      });
      vi.stubGlobal("fetch", fetchMock);

      await GET(createRequest(VALID_ADDRESS, "1.2.3.4"));

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toContain(VALID_ADDRESS);
      expect(options.headers["X-API-KEY"]).toBe("test-api-key");
    });
  });

  describe("sanctioned address", () => {
    it("returns isSanctioned: true when identifications are present", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              identifications: [{ category: "sanctions", name: "OFAC SDN" }],
            }),
        }),
      );

      const response = await GET(createRequest(VALID_ADDRESS, "1.2.3.4"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.isSanctioned).toBe(true);
    });
  });

  describe("API failure (fail-closed)", () => {
    it("returns 502 with isSanctioned: null on upstream error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const response = await GET(createRequest(VALID_ADDRESS, "1.2.3.4"));
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.isSanctioned).toBeNull();
      expect(body.error).toBe("check_failed");
    });

    it("returns 502 with isSanctioned: null on network error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );

      const response = await GET(createRequest(VALID_ADDRESS, "1.2.3.4"));
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.isSanctioned).toBeNull();
      expect(body.error).toBe("check_failed");
    });
  });

  describe("malformed API response", () => {
    it("returns isSanctioned: false when identifications field is missing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        }),
      );

      const response = await GET(createRequest(VALID_ADDRESS, "1.2.3.4"));
      const body = await response.json();
      expect(body.isSanctioned).toBe(false);
      expect(body.error).toBeUndefined();
    });

    it("returns isSanctioned: false when identifications is not an array", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ identifications: "not-an-array" }),
        }),
      );

      const response = await GET(createRequest(VALID_ADDRESS, "1.2.3.4"));
      const body = await response.json();
      expect(body.isSanctioned).toBe(false);
      expect(body.error).toBeUndefined();
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding rate limit", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ identifications: [] }),
        }),
      );

      const ip = "10.0.0.1";
      const responses = [];

      for (let i = 0; i < 62; i++) {
        responses.push(await GET(createRequest(VALID_ADDRESS, ip)));
      }

      const lastResponse = responses[responses.length - 1]!;
      expect(lastResponse.status).toBe(429);
      const body = await lastResponse.json();
      expect(body.error).toBe("Too many requests");
    });
  });
});
