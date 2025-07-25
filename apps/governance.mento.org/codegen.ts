import { CodegenConfig } from "@graphql-codegen/cli";
import "dotenv/config";

const CELO_EXPLORER_API_URL = process.env.NEXT_PUBLIC_CELO_EXPLORER_API_URL;

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL;

const config: CodegenConfig = {
  generates: {
    // NOTE: In case we need to use different subgraph URLs for different environments
    // we'll need to add another element to the object below, i.e. "./app/graphql/subgraph-alfajores/generated"
    "./app/lib/graphql/subgraph/generated/subgraph.tsx": {
      overwrite: true,
      schema: [SUBGRAPH_URL ?? "", "./schema.client.graphql"],
      documents: ["app/lib/graphql/subgraph/**/*.graphql"],
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
    "./app/lib/graphql/celo-explorer/generated/celoGraph.tsx": {
      overwrite: true,
      schema: CELO_EXPLORER_API_URL,
      documents: ["app/lib/graphql/celo-explorer/**/*.graphql"],
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
