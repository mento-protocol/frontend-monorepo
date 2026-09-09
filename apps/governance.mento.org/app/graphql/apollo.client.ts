"use client";

import { ProposalPolicy } from "./subgraph/policies/Proposal";
import { ApolloLink } from "@apollo/client";
import {
  ApolloClient,
  InMemoryCache,
  SSRMultipartLink,
} from "@apollo/client-integration-nextjs";
import { SetContextLink } from "@apollo/client/link/context";
import { HttpLink } from "@apollo/client/link/http";
import { LocalState } from "@apollo/client/local-state";
import { env } from "@/env.mjs";
import { getGraphAuthorization } from "./graph-gateway";

// One source of truth for "which URL does this apiName hit". Both the
// transport and the auth link consult it, so the key decision can never
// disagree with the destination.
function resolveEndpoint(apiName: unknown): string {
  switch (apiName) {
    case "celoExplorer":
      return env.NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL;
    case "celoExplorerCeloSepolia":
      return env.NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL_CELO_SEPOLIA;
    case "subgraph":
      return env.NEXT_PUBLIC_SUBGRAPH_URL;
    case "subgraphCeloSepolia":
      return env.NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA;
    default:
      return env.NEXT_PUBLIC_SUBGRAPH_URL;
  }
}

// have a function to create a client for you
export function makeClient() {
  const httpLink = new HttpLink({
    // needs to be an absolute url, as relative urls cannot be used in SSR
    uri: (operation) => resolveEndpoint(operation.getContext().apiName),

    // you can disable result caching here if you want to
    // (this does not work if you are rendering your page with `export const dynamic = "force-static"`)
    fetchOptions: { cache: "no-store" },
    // you can override the default `fetchOptions` on a per query basis
    // via the `context` property on the options passed as a second argument
    // to an Apollo Client data fetching hook, e.g.:
    // const { data } = useSuspenseQuery(MY_QUERY, { context: { fetchOptions: { cache: "force-cache" }}});
  });

  // Auth link to add API keys to requests
  const authLink = new SetContextLink(({ apiName, headers }) => {
    // Only subgraph operations are candidates for the key, and only when the
    // resolved endpoint is the gateway. A chain that has moved to a Studio
    // dev endpoint gets no key, since Studio does not take one.
    const isSubgraphOperation =
      apiName === "subgraph" || apiName === "subgraphCeloSepolia";
    const authorization = isSubgraphOperation
      ? getGraphAuthorization(
          resolveEndpoint(apiName),
          env.NEXT_PUBLIC_GRAPH_API_KEY,
        )
      : undefined;

    // Return the headers to the context so httpLink can read them
    return {
      headers: {
        ...headers,
        ...(authorization && { authorization }),
      },
    };
  });

  const cache = new InMemoryCache({
    typePolicies: {
      Proposal: ProposalPolicy,
    },
  });

  return new ApolloClient({
    cache,
    localState: new LocalState(),
    defaultOptions: {
      watchQuery: {
        notifyOnNetworkStatusChange: false,
      },
    },
    link:
      typeof window === "undefined"
        ? ApolloLink.from([
            // in a SSR environment, if you use multipart features like
            // @defer, you need to decide how to handle these.
            // This strips all interfaces with a `@defer` directive from your queries.
            new SSRMultipartLink({
              stripDefer: true,
            }),
            authLink,
            httpLink,
          ])
        : authLink.concat(httpLink),
  });
}
