"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  context?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to Sentry with context
    Sentry.withScope((scope) => {
      scope.setTag("component", "ExecutionCode");
      scope.setContext("errorBoundary", {
        context: this.props.context || "Unknown",
        componentStack: errorInfo.componentStack,
      });
      Sentry.captureException(error);
    });

    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">
              Error Loading Execution Code
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              There was an error displaying the execution code for this
              proposal. The error has been reported and will be investigated.
            </p>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details className="mt-4">
                <summary className="cursor-pointer font-mono text-sm">
                  Error Details (Development Only)
                </summary>
                <pre className="mt-2 overflow-x-auto text-xs">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
