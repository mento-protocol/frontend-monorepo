import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureExceptionMock, loggerErrorMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@repo/web3", () => ({
  logger: { error: loggerErrorMock },
}));

vi.mock("@mento-protocol/ui", () => ({
  links: { links: { discord: "https://discord.example" } },
}));

import { ErrorBoundary } from "./errors";

const renderError = new Error("render failed");

function ThrowingChild(): React.ReactElement {
  throw renderError;
}

beforeEach(() => {
  // React logs caught render errors to the console; keep the output quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  captureExceptionMock.mockReset();
  loggerErrorMock.mockReset();
});

describe("ErrorBoundary", () => {
  it("reports a render error to Sentry with the component stack", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [error, hint] = captureExceptionMock.mock.calls[0] ?? [];
    expect(error).toBe(renderError);
    expect(typeof hint.contexts.react.componentStack).toBe("string");
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it("shows the fail screen after a render error", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong, sorry!")).not.toBeNull();
    expect(screen.getByText("render failed")).not.toBeNull();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>healthy</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("healthy")).not.toBeNull();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
