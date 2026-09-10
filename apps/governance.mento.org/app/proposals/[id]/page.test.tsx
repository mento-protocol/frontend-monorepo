import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/components/proposal/content", () => ({
  ProposalContent: () => null,
}));

vi.mock("@/env.mjs", () => ({
  env: {
    NEXT_PUBLIC_GRAPH_API_KEY: "test-graph-api-key",
    NEXT_PUBLIC_SUBGRAPH_URL:
      "https://gateway.thegraph.com/api/subgraphs/id/test-mainnet",
    NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA:
      "https://api.studio.thegraph.com/query/1724470/mento-governance-celo-sepolia/v1.0.1",
    NEXT_PUBLIC_SUBGRAPH_FALLBACK_URL:
      "https://api.studio.thegraph.com/query/1724470/mento-governance-celo/v1.0.1",
    NEXT_PUBLIC_VERCEL_ENV: "production",
  },
}));

const { generateMetadata } = await import("./page");

afterEach(() => {
  vi.unstubAllGlobals();
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
