"use client";

import { ApolloNextAppProvider } from "@apollo/experimental-nextjs-app-support";
import { PropsWithChildren } from "react";
import { makeClient } from "./graphql/apollo.client";

export const ApolloProvider = ({ children }: PropsWithChildren) => {
  return (
    <ApolloNextAppProvider makeClient={makeClient}>
      {children}
    </ApolloNextAppProvider>
  );
};
