import { gql } from "@apollo/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env.mjs", () => ({
  env: {
    NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL: "https://example.com/blockscout",
    NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL_CELO_SEPOLIA:
      "https://example.com/blockscout-sepolia",
    NEXT_PUBLIC_GRAPH_API_KEY: "test-graph-api-key",
    NEXT_PUBLIC_SUBGRAPH_URL: "https://example.com/subgraph",
    NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA:
      "https://example.com/subgraph-sepolia",
  },
}));

const { makeClient } = await import("./apollo.client");

const query = gql`
  query ApolloLocalStateTest {
    proposals {
      proposalId
      description
      metadata @client {
        title
        description
      }
    }
  }
`;

const transportQuery = gql`
  query ApolloTransportTest {
    proposals {
      proposalId
    }
  }
`;

function emptyProposalResponse() {
  return new Response(JSON.stringify({ data: { proposals: [] } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeClient", () => {
  it.each([
    {
      apiName: "celoExplorer",
      authorization: null,
      expectedUrl: "https://example.com/blockscout",
    },
    {
      apiName: "celoExplorerCeloSepolia",
      authorization: null,
      expectedUrl: "https://example.com/blockscout-sepolia",
    },
    {
      apiName: "subgraph",
      authorization: "Bearer test-graph-api-key",
      expectedUrl: "https://example.com/subgraph",
    },
    {
      apiName: "subgraphCeloSepolia",
      authorization: "Bearer test-graph-api-key",
      expectedUrl: "https://example.com/subgraph-sepolia",
    },
    {
      apiName: undefined,
      authorization: null,
      expectedUrl: "https://example.com/subgraph",
    },
  ])(
    "routes $apiName operations to $expectedUrl",
    async ({ apiName, authorization, expectedUrl }) => {
      const fetchMock = vi.fn().mockResolvedValue(emptyProposalResponse());
      vi.stubGlobal("fetch", fetchMock);

      const result = await makeClient().query({
        query: transportQuery,
        fetchPolicy: "network-only",
        context: {
          ...(apiName && { apiName }),
          headers: { "x-test-header": "preserved" },
        },
      });

      expect(result.error).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, options] = fetchMock.mock.calls[0] as [
        RequestInfo | URL,
        RequestInit,
      ];
      const headers = new Headers(options.headers);

      expect(url).toBe(expectedUrl);
      expect(headers.get("authorization")).toBe(authorization);
      expect(headers.get("x-test-header")).toBe("preserved");
    },
  );

  it("resolves local proposal fields in network queries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              proposals: [
                {
                  __typename: "Proposal",
                  proposalId: "1",
                  description: JSON.stringify({
                    title: "Test title",
                    description: "Test description",
                  }),
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const result = await makeClient().query<{
      proposals: Array<{
        metadata: { title: string; description: string };
      }>;
    }>({
      query,
      fetchPolicy: "network-only",
      errorPolicy: "all",
      context: { apiName: "subgraph" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.proposals[0]?.metadata).toEqual({
      title: "Test title",
      description: "Test description",
    });
  });
});
