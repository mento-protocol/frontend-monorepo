import { describe, expect, it } from "vitest";
import { getGraphAuthorization, isGraphGatewayUrl } from "./graph-gateway";

const GATEWAY = "https://gateway.thegraph.com/api/subgraphs/id/abc123";
const STUDIO =
  "https://api.studio.thegraph.com/query/1724470/mento-governance-celo-sepolia/v1.0.1";

describe("isGraphGatewayUrl", () => {
  it("recognises the decentralized-network gateway", () => {
    expect(isGraphGatewayUrl(GATEWAY)).toBe(true);
    expect(
      isGraphGatewayUrl("https://gateway.thegraph.com/api/deployments/id/Qm1"),
    ).toBe(true);
  });

  it("rejects the gateway host over plain http", () => {
    expect(
      isGraphGatewayUrl("http://gateway.thegraph.com/api/subgraphs/id/abc123"),
    ).toBe(false);
    expect(
      getGraphAuthorization(
        "http://gateway.thegraph.com/api/subgraphs/id/abc123",
        "secret",
      ),
    ).toBeUndefined();
  });

  it("rejects Studio, lookalike hosts, and junk", () => {
    expect(isGraphGatewayUrl(STUDIO)).toBe(false);
    expect(
      isGraphGatewayUrl("https://gateway.thegraph.com.evil.example/x"),
    ).toBe(false);
    expect(isGraphGatewayUrl("https://evil.example/gateway.thegraph.com")).toBe(
      false,
    );
    expect(isGraphGatewayUrl("not-a-url")).toBe(false);
    expect(isGraphGatewayUrl("")).toBe(false);
    expect(isGraphGatewayUrl(undefined)).toBe(false);
  });
});

describe("getGraphAuthorization", () => {
  it("authenticates gateway requests", () => {
    expect(getGraphAuthorization(GATEWAY, "secret")).toBe("Bearer secret");
  });

  it("withholds the key from Studio, even when one is configured", () => {
    expect(getGraphAuthorization(STUDIO, "secret")).toBeUndefined();
  });

  it("sends nothing when no key is configured", () => {
    expect(getGraphAuthorization(GATEWAY, undefined)).toBeUndefined();
    expect(getGraphAuthorization(GATEWAY, "   ")).toBeUndefined();
  });
});
