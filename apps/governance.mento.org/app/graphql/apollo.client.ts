"use client";

import { ProposalPolicy } from "./subgraph/policies/Proposal";
import { ApolloLink, createHttpLink } from "@apollo/client";
import {
  ApolloClient,
  InMemoryCache,
  SSRMultipartLink,
} from "@apollo/client-integration-nextjs";
import { setContext } from "@apollo/client/link/context";
import { env } from "@/env.mjs";

// have a function to create a client for you
export function makeClient() {
  const httpLink = createHttpLink({
    // needs to be an absolute url, as relative urls cannot be used in SSR
    uri: (operation) => {
      const { apiName } = operation.getContext();
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
    },

    // you can disable result caching here if you want to
    // (this does not work if you are rendering your page with `export const dynamic = "force-static"`)
    fetchOptions: { cache: "no-store" },
    // you can override the default `fetchOptions` on a per query basis
    // via the `context` property on the options passed as a second argument
    // to an Apollo Client data fetching hook, e.g.:
    // const { data } = useSuspenseQuery(MY_QUERY, { context: { fetchOptions: { cache: "force-cache" }}});
  });

  // Auth link to add API keys to requests
  const authLink = setContext((_, { headers, ...context }) => {
    const { apiName } = context;

    // Determine which API key to use based on the API name
    let authToken = "";

    switch (apiName) {
      case "subgraph":
      case "subgraphCeloSepolia":
        authToken = env.NEXT_PUBLIC_GRAPH_API_KEY;
        break;
      default:
        authToken = "";
        break;
    }

    // Return the headers to the context so httpLink can read them
    return {
      headers: {
        ...headers,
        // Add authorization header if API key exists
        ...(authToken && { authorization: `Bearer ${authToken}` }),
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
