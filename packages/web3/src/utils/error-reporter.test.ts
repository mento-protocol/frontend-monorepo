import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError, setErrorReporter } from "./error-reporter";

afterEach(() => {
  setErrorReporter(null);
});

describe("reportError", () => {
  it("does nothing when no reporter is registered", () => {
    expect(() => reportError(new Error("boom"))).not.toThrow();
  });

  it("passes the error and context to the registered reporter", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const error = new Error("boom");

    reportError(error, { flow: "swap" });

    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith(error, { flow: "swap" });
  });

  it("does not report a user rejection", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);

    reportError({ code: 4001, message: "User rejected the request." });

    expect(reporter).not.toHaveBeenCalled();
  });

  it("does not propagate an error thrown by the reporter", () => {
    setErrorReporter(() => {
      throw new Error("reporter failed");
    });

    expect(() => reportError(new Error("boom"))).not.toThrow();
  });

  it("stops reporting once the reporter is cleared", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    setErrorReporter(null);

    reportError(new Error("boom"));

    expect(reporter).not.toHaveBeenCalled();
  });
});
