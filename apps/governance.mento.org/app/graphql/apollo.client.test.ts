import { gql } from "@apollo/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env.mjs", () => ({
  env: {
    NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL: "https://example.com/blockscout",
    NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL_CELO_SEPOLIA:
      "https://example.com/blockscout-sepolia",
    NEXT_PUBLIC_GRAPH_API_KEY: "",
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeClient", () => {
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
