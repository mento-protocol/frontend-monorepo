import { describe, expect, it } from "vitest";
import { getGraphRequestOrigin } from "./graph-request-origin";

describe("getGraphRequestOrigin", () => {
  it("uses the public Governance origin for production requests", () => {
    expect(
      getGraphRequestOrigin({
        vercelEnvironment: "production",
        vercelUrl: "ignored.vercel.app",
      }),
    ).toBe("https://governance.mento.org");
  });

  it("uses an exact Mento deployment origin for preview requests", () => {
    expect(
      getGraphRequestOrigin({
        vercelEnvironment: "preview",
        vercelUrl: "governancemento-abc123-mentolabs.vercel.app",
      }),
    ).toBe("https://governancemento-abc123-mentolabs.vercel.app");
  });

  it.each([
    undefined,
    "governancemento.vercel.app",
    "governancemento-abc123-mentolabs.vercel.app.example.com",
    "https://governancemento-abc123-mentolabs.vercel.app/path",
  ])("rejects an invalid preview VERCEL_URL: %s", (vercelUrl) => {
    expect(() =>
      getGraphRequestOrigin({ vercelEnvironment: "preview", vercelUrl }),
    ).toThrow();
  });

  it("uses the Governance development origin outside Vercel", () => {
    expect(getGraphRequestOrigin({ vercelEnvironment: "development" })).toBe(
      "http://localhost:3002",
    );
  });
});
