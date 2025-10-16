"use client";

import { ApolloNextAppProvider } from "@apollo/client-integration-nextjs";
import { PropsWithChildren } from "react";
import { makeClient } from "./graphql/apollo.client";

export const ApolloProvider = ({ children }: PropsWithChildren) => {
  return (
    <ApolloNextAppProvider makeClient={makeClient}>
      Test
      {children}
    </ApolloNextAppProvider>
  );
};
