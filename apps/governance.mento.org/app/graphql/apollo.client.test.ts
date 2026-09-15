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
    // Mainnet is on the decentralized-network gateway (takes the key);
    // Celo Sepolia is on a Studio dev endpoint (must NOT be sent the key).
    NEXT_PUBLIC_SUBGRAPH_URL:
      "https://gateway.thegraph.com/api/subgraphs/id/test-mainnet",
    NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA:
      "https://api.studio.thegraph.com/query/1724470/mento-governance-celo-sepolia/v1.0.1",
    // Mainnet's fallback: the Studio dev endpoint for the same subgraph.
    NEXT_PUBLIC_SUBGRAPH_FALLBACK_URL:
      "https://api.studio.thegraph.com/query/1724470/mento-governance-celo/v1.0.1",
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

// The gateway's "I can't serve this" shape: HTTP 200, errors, no data.
function gatewayUnavailableResponse() {
  return new Response(
    JSON.stringify({
      errors: [
        {
          message:
            "bad indexers: {0xbdfb5ee5a2abf4fc7bb1bd1221067aef7f9de491: Unavailable(no status: indexer not available)}",
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

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
      expectedUrl: "https://gateway.thegraph.com/api/subgraphs/id/test-mainnet",
    },
    {
      // Studio host: key configured, deliberately withheld.
      apiName: "subgraphCeloSepolia",
      authorization: null,
      expectedUrl:
        "https://api.studio.thegraph.com/query/1724470/mento-governance-celo-sepolia/v1.0.1",
    },
    {
      apiName: undefined,
      authorization: null,
      expectedUrl: "https://gateway.thegraph.com/api/subgraphs/id/test-mainnet",
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

  describe("mainnet fallback", () => {
    const GATEWAY =
      "https://gateway.thegraph.com/api/subgraphs/id/test-mainnet";
    const FALLBACK =
      "https://api.studio.thegraph.com/query/1724470/mento-governance-celo/v1.0.1";

    function calledUrls(fetchMock: ReturnType<typeof vi.fn>) {
      return fetchMock.mock.calls.map(([url]) => String(url));
    }

    // Apollo may either reject or resolve with `error` depending on policy;
    // the fallback tests only care that a failure was reported.
    async function queryOutcome(apiName: string) {
      try {
        const result = await makeClient().query({
          query: transportQuery,
          fetchPolicy: "network-only",
          context: { apiName },
        });
        return { failed: result.error !== undefined };
      } catch {
        return { failed: true };
      }
    }

    it("retries once on Studio when the gateway answers 200 with only errors", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(gatewayUnavailableResponse())
        .mockResolvedValueOnce(emptyProposalResponse());
      vi.stubGlobal("fetch", fetchMock);

      const result = await makeClient().query({
        query: transportQuery,
        fetchPolicy: "network-only",
        context: { apiName: "subgraph" },
      });

      expect(result.error).toBeUndefined();
      expect(result.data).toEqual({ proposals: [] });
      expect(calledUrls(fetchMock)).toEqual([GATEWAY, FALLBACK]);

      // The retry went to Studio, which must not be handed the gateway key.
      const [, retryOptions] = fetchMock.mock.calls[1] as [
        unknown,
        RequestInit,
      ];
      expect(new Headers(retryOptions.headers).get("authorization")).toBeNull();
    });

    it("retries once on Studio when the gateway fails at the transport level", async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(emptyProposalResponse());
      vi.stubGlobal("fetch", fetchMock);

      const result = await makeClient().query({
        query: transportQuery,
        fetchPolicy: "network-only",
        context: { apiName: "subgraph" },
      });

      expect(result.error).toBeUndefined();
      expect(calledUrls(fetchMock)).toEqual([GATEWAY, FALLBACK]);
    });

    it("does not fall back for Celo Sepolia, whose primary is already Studio", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(gatewayUnavailableResponse()),
        );
      vi.stubGlobal("fetch", fetchMock);

      expect(await queryOutcome("subgraphCeloSepolia")).toEqual({
        failed: true,
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("surfaces the failure after exactly one retry when Studio is also down", async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(gatewayUnavailableResponse()),
        );
      vi.stubGlobal("fetch", fetchMock);

      expect(await queryOutcome("subgraph")).toEqual({ failed: true });
      expect(calledUrls(fetchMock)).toEqual([GATEWAY, FALLBACK]);
    });
  });

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
