"use client";

import { links } from "@repo/ui";
import { logger } from "@repo/web3";
import { Frown } from "lucide-react";
import { Component, PropsWithChildren, type ErrorInfo } from "react";

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<
  PropsWithChildren,
  ErrorBoundaryState
> {
  constructor(props: PropsWithChildren) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });
    logger.error("Error caught by error boundary", error, errorInfo);
  }

  render() {
    const { error, errorInfo } = this.state;
    if (error || errorInfo) {
      const details = (error && error.message) || JSON.stringify(errorInfo);
      return <FailScreen details={details.substring(0, 120)} />;
    }
    return this.props.children;
  }
}

function FailScreen({ details }: { details?: string }) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-background">
      <div className="left-5 top-5 sm:block fixed hidden">Mento Logo</div>
      <FailContent details={details} />
    </div>
  );
}

function FailContent({ details }: { details?: string }) {
  return (
    <div className="p-5 flex flex-col items-center justify-center">
      <h1 className="mb-2 text-2xl text-center">
        Something went wrong, sorry!
      </h1>
      <Frown />
      <h3 className="mt-2 text-lg text-center">
        Please refresh the page. If the problem persists, you can{" "}
        <a href={links.links.discord} className="underline">
          ask for help on Discord
        </a>
        .
      </h3>
      {details && (
        <p className="text-md mt-6 text-center text-muted-foreground">
          {details}
        </p>
      )}
    </div>
  );
}
