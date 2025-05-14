"use client";

import { TextLink } from "@/components/buttons/text-link";
import { links } from "@/lib/config/links";
import { logger } from "@/lib/utils/logger";
import { Frown } from "lucide-react";
import { Component } from "react";

interface ErrorBoundaryState {
  error: any;
  errorInfo: any;
}

export class ErrorBoundary extends Component<any, ErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: any, errorInfo: any) {
    this.setState({
      error,
      errorInfo,
    });
    logger.error("Error caught by error boundary", error, errorInfo);
  }

  render() {
    const errorInfo = this.state.error || this.state.errorInfo;
    if (errorInfo) {
      const details = errorInfo.message || JSON.stringify(errorInfo);
      return <FailScreen details={details.substr(0, 120)} />;
    }
    return this.props.children;
  }
}

function FailScreen({ details }: { details?: string }) {
  return (
    <div className="bg-gradient-linear flex h-screen w-screen flex-col items-center justify-center">
      <div className="fixed left-5 top-5 hidden sm:block">Mento Logo</div>
      <FailContent details={details} />
    </div>
  );
}

export function FailContent({ details }: { details?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-5">
      <h1 className="mb-2 text-center text-2xl">
        Something went wrong, sorry!
      </h1>
      <Frown />
      <h3 className="mt-2 text-center text-lg">
        Please refresh the page. If the problem persists, you can{" "}
        <TextLink href={links.discord} className="underline">
          ask for help on Discord
        </TextLink>
        .
      </h3>
      {details && (
        <p className="text-md mt-6 text-center text-gray-500">{details}</p>
      )}
    </div>
  );
}
