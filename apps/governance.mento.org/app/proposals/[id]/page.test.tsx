import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/proposal/content", () => ({
  ProposalContent: () => null,
}));

const mockEnv = vi.hoisted(() => ({
  NEXT_PUBLIC_GRAPH_API_KEY: "test-graph-api-key",
  NEXT_PUBLIC_SUBGRAPH_URL:
    "https://gateway.thegraph.com/api/subgraphs/id/test-mainnet",
  NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA:
    "https://api.studio.thegraph.com/query/1724470/mento-governance-celo-sepolia/v1.0.1",
  NEXT_PUBLIC_SUBGRAPH_FALLBACK_URL:
    "https://api.studio.thegraph.com/query/1724470/mento-governance-celo/v1.0.1" as
      | string
      | undefined,
  NEXT_PUBLIC_VERCEL_ENV: "production",
}));
vi.mock("@/env.mjs", () => ({ env: mockEnv }));

const { generateMetadata } = await import("./page");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("sends the authorized production origin when it loads proposal metadata", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          proposals: [
            {
              proposalId: "21",
              description: JSON.stringify({
                title: "MGP-19",
                description: "Proposal description",
              }),
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const metadata = await generateMetadata({
    params: Promise.resolve({ id: "21" }),
  });

  expect(metadata.title).toBe("MGP-19");
  expect(metadata.description).toBe("Proposal description");
  expect(fetchMock).toHaveBeenCalledOnce();

  const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  const headers = new Headers(options.headers);
  expect(headers.get("authorization")).toBe("Bearer test-graph-api-key");
  expect(headers.get("origin")).toBe("https://governance.mento.org");
});

it("falls back to Studio, without the key, when the gateway is unavailable", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: "subgraph not found: no allocations" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            proposals: [
              {
                proposalId: "21",
                description: JSON.stringify({
                  title: "MGP-19",
                  description: "From the fallback",
                }),
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);

  const metadata = await generateMetadata({
    params: Promise.resolve({ id: "21" }),
  });

  expect(metadata.description).toBe("From the fallback");
  expect(fetchMock).toHaveBeenCalledTimes(2);

  const [primaryUrl, primaryOptions] = fetchMock.mock.calls[0] as [
    string,
    RequestInit,
  ];
  const [fallbackUrl, fallbackOptions] = fetchMock.mock.calls[1] as [
    string,
    RequestInit,
  ];
  expect(primaryUrl).toBe(
    "https://gateway.thegraph.com/api/subgraphs/id/test-mainnet",
  );
  expect(new Headers(primaryOptions.headers).get("authorization")).toBe(
    "Bearer test-graph-api-key",
  );
  expect(fallbackUrl).toBe(
    "https://api.studio.thegraph.com/query/1724470/mento-governance-celo/v1.0.1",
  );
  expect(new Headers(fallbackOptions.headers).get("authorization")).toBeNull();
});

it.each(["transport", "invalid JSON"])(
  "falls back after a primary %s failure",
  async (failure) => {
    const fetchMock = vi.fn();
    if (failure === "transport")
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    else
      fetchMock.mockResolvedValueOnce(
        new Response("not JSON", { status: 200 }),
      );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            proposals: [
              {
                description: JSON.stringify({
                  title: "Recovered proposal",
                  description: "Fallback metadata",
                }),
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: "21" }),
    });
    expect(metadata.title).toBe("Recovered proposal");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("api.studio.thegraph.com");
    expect(new Headers(options.headers).get("authorization")).toBeNull();
  },
);

it("returns generic metadata after both transports fail without another retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  vi.stubGlobal("fetch", fetchMock);
  const metadata = await generateMetadata({
    params: Promise.resolve({ id: "21" }),
  });
  expect(metadata.title).toBe("Proposal #21");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each(["unset fallback", "Celo Sepolia"])(
  "does not retry with %s",
  async (scenario) => {
    const previousFallback = mockEnv.NEXT_PUBLIC_SUBGRAPH_FALLBACK_URL;
    const previousEnvironment = mockEnv.NEXT_PUBLIC_VERCEL_ENV;
    try {
      if (scenario === "unset fallback")
        mockEnv.NEXT_PUBLIC_SUBGRAPH_FALLBACK_URL = undefined;
      else mockEnv.NEXT_PUBLIC_VERCEL_ENV = "development";
      vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError("fetch failed"));
      vi.stubGlobal("fetch", fetchMock);
      const metadata = await generateMetadata({
        params: Promise.resolve({ id: "21" }),
      });
      expect(metadata.title).toBe("Proposal #21");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        scenario === "Celo Sepolia"
          ? mockEnv.NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA
          : mockEnv.NEXT_PUBLIC_SUBGRAPH_URL,
      );
    } finally {
      mockEnv.NEXT_PUBLIC_SUBGRAPH_FALLBACK_URL = previousFallback;
      mockEnv.NEXT_PUBLIC_VERCEL_ENV = previousEnvironment;
    }
  },
);
