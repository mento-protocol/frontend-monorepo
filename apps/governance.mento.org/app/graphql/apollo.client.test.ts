import { gql, type ObservableQuery } from "@apollo/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GetProposalsDocument,
  type GetProposalsQuery,
  type GetProposalsQueryVariables,
} from "@/graphql/subgraph/generated/subgraph";

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
      __typename: "ProposalMetadata",
      title: "Test title",
      description: "Test description",
    });
  });

  it("resolves nested local proposal fields in watched queries", async () => {
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
                  proposer: {
                    __typename: "Account",
                    id: "0x0000000000000000000000000000000000000002",
                  },
                  proposalCreated: [],
                  proposalQueued: [],
                  proposalExecuted: [],
                  proposalCanceled: [],
                  votecast: [
                    {
                      __typename: "VoteCast",
                      id: "vote-1",
                      support: {
                        __typename: "ProposalSupport",
                        weight: "10",
                      },
                      receipt: {
                        __typename: "VoteReceipt",
                        id: "receipt-1",
                        voter: {
                          __typename: "Account",
                          id: "0x0000000000000000000000000000000000000001",
                        },
                        weight: "10",
                        support: {
                          __typename: "ProposalSupport",
                          id: "support-1",
                          support: 1,
                        },
                      },
                    },
                  ],
                  startBlock: "1",
                  endBlock: "2",
                  queued: false,
                  canceled: false,
                  executed: false,
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

    const observable = makeClient().watchQuery<
      GetProposalsQuery,
      GetProposalsQueryVariables
    >({
      query: GetProposalsDocument,
      fetchPolicy: "network-only",
      errorPolicy: "all",
      context: { apiName: "subgraph" },
    });
    const result = await new Promise<ObservableQuery.Result<GetProposalsQuery>>(
      (resolve, reject) => {
        const subscription = observable.subscribe({
          next: (nextResult) => {
            if (!nextResult.loading) {
              subscription.unsubscribe();
              resolve(nextResult);
            }
          },
          error: reject,
        });
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.proposals?.[0]).toMatchObject({
      metadata: {
        __typename: "ProposalMetadata",
        title: "Test title",
        description: "Test description",
      },
      votes: {
        __typename: "ProposalVotes",
        for: {
          __typename: "VoteType",
          participants: [
            {
              __typename: "Participant",
              address: "0x0000000000000000000000000000000000000001",
              weight: 10n,
            },
          ],
          total: 10n,
        },
        against: {
          __typename: "VoteType",
          participants: [],
          total: 0n,
        },
        abstain: {
          __typename: "VoteType",
          participants: [],
          total: 0n,
        },
        total: 10n,
      },
    });
  });
});
