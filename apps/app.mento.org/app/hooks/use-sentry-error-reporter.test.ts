import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { captureExceptionMock, setErrorReporterMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  setErrorReporterMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@repo/web3", () => ({
  setErrorReporter: setErrorReporterMock,
}));

import { useSentryErrorReporter } from "./use-sentry-error-reporter";

afterEach(() => {
  captureExceptionMock.mockReset();
  setErrorReporterMock.mockReset();
});

describe("useSentryErrorReporter", () => {
  it("registers a reporter that forwards errors to Sentry", () => {
    renderHook(() => useSentryErrorReporter());

    expect(setErrorReporterMock).toHaveBeenCalledTimes(1);
    const reporter = setErrorReporterMock.mock.calls[0]?.[0];
    expect(typeof reporter).toBe("function");

    const error = new Error("boom");
    reporter(error, { flow: "swap" });

    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      extra: { flow: "swap" },
    });
  });

  it("clears the reporter on unmount", () => {
    const { unmount } = renderHook(() => useSentryErrorReporter());
    setErrorReporterMock.mockClear();

    unmount();

    expect(setErrorReporterMock).toHaveBeenCalledTimes(1);
    expect(setErrorReporterMock).toHaveBeenCalledWith(null);
  });
});
