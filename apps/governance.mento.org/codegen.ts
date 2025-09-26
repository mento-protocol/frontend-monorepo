import { CodegenConfig } from "@graphql-codegen/cli";
import "dotenv/config";

const CELO_EXPLORER_API_URL = process.env.NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL;

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL;
const GRAPH_API_KEY = process.env.NEXT_PUBLIC_GRAPH_API_KEY;

const config: CodegenConfig = {
  generates: {
    // NOTE: In case we need to use different subgraph URLs for different environments
    // we'll need to add another element to the object below, i.e. "./app/graphql/subgraph-alfajores/generated"
    "./app/graphql/subgraph/generated/subgraph.tsx": {
      overwrite: true,
      schema: {
        [SUBGRAPH_URL ?? ""]: {
          headers: {
            Authorization: `Bearer ${GRAPH_API_KEY}`,
          },
        },
        "./schema.client.graphql": {},
      },
      documents: ["app/graphql/subgraph/**/*.graphql"],
      presetConfig: {
        gqlTagName: "gql",
      },
      plugins: [
        "typescript",
        "typescript-operations",
        "typescript-react-apollo",
        "typescript-apollo-client-helpers",
        {
          add: {
            content: "/* eslint-disable */",
          },
        },
      ],
      config: {
        reactApolloVersion: 3,
        withHooks: true,
        withReturnType: true,
        avoidOptionals: true,
      },
    },
    "./app/graphql/celo-explorer/generated/celoGraph.tsx": {
      overwrite: true,
      schema: CELO_EXPLORER_API_URL,
      documents: ["app/graphql/celo-explorer/**/*.graphql"],
      plugins: [
        "typescript",
        "typescript-operations",
        "typescript-react-apollo",
        {
          add: {
            content: "/* eslint-disable */",
          },
        },
      ],
      config: {
        reactApolloVersion: 3,
        withHooks: true,
        withReturnType: true,
      },
    },
  },
  ignoreNoDocuments: true,
};

export default config;
