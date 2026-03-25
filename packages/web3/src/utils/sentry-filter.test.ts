import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import {
  filterNoisySentryEvents,
  sentryDenyUrls,
  sentryIgnoreErrors,
} from "./sentry-filter";

function makeEvent({
  message,
  exceptionValue,
  exceptionType,
  frames = [],
  requestUrl,
  transaction,
}: {
  message?: string;
  exceptionValue?: string;
  exceptionType?: string;
  frames?: string[];
  requestUrl?: string;
  transaction?: string;
} = {}): ErrorEvent {
  return {
    message,
    transaction,
    request: requestUrl ? { url: requestUrl } : undefined,
    exception: exceptionValue
      ? {
          values: [
            {
              type: exceptionType ?? "Error",
              value: exceptionValue,
              stacktrace: {
                frames: frames.map((filename) => ({ filename })),
              },
            },
          ],
        }
      : frames.length > 0
        ? {
            values: [
              {
                type: "Error",
                stacktrace: {
                  frames: frames.map((filename) => ({ filename })),
                },
              },
            ],
          }
        : undefined,
  } as ErrorEvent;
}

describe("sentry-filter", () => {
  it("exports the expected extension deny-url filters", () => {
    expect(sentryDenyUrls).toEqual(
      expect.arrayContaining([
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
      ]),
    );
  });

  it("exports the expected hard-ignore patterns", () => {
    expect(sentryIgnoreErrors).toEqual(
      expect.arrayContaining([/Origin not allowed/i]),
    );
  });

  it("drops known always-ignore messages", () => {
    const event = makeEvent({ message: "Origin not allowed" });

    expect(filterNoisySentryEvents(event)).toBeNull();
  });

  it("drops Merkl proxy transport failures on the Merkl route", () => {
    const event = makeEvent({
      exceptionType: "AbortError",
      exceptionValue: "The operation was aborted",
      requestUrl: "https://app.mento.org/api/merkl/opportunities?chainId=42220",
    });

    expect(filterNoisySentryEvents(event)).toBeNull();
  });

  it("keeps Merkl proxy transport failures on the Merkl route when they are not explicit aborts", () => {
    const event = makeEvent({
      exceptionValue: "fetch failed",
      requestUrl: "https://app.mento.org/api/merkl/opportunities?chainId=42220",
    });

    expect(filterNoisySentryEvents(event)).toBe(event);
  });

  it("keeps Merkl-like transport failures outside the Merkl route", () => {
    const event = makeEvent({
      exceptionValue: "fetch failed",
      requestUrl: "https://app.mento.org/api/other-endpoint",
    });

    expect(filterNoisySentryEvents(event)).toBe(event);
  });

  it("drops shared-environment errors when only extension frames are present", () => {
    const event = makeEvent({
      exceptionValue: "Maximum call stack size exceeded",
      frames: ["chrome-extension://wallet/content.js"],
    });

    expect(filterNoisySentryEvents(event)).toBeNull();
  });

  it("drops shared-environment errors when no first-party frames are present", () => {
    const event = makeEvent({
      exceptionValue: "Cannot read properties of null (reading 'removeChild')",
      frames: ["https://cdn.example.com/widget.js"],
    });

    expect(filterNoisySentryEvents(event)).toBeNull();
  });

  it("keeps shared-environment errors when first-party frames are present", () => {
    const event = makeEvent({
      exceptionValue: "Maximum call stack size exceeded",
      frames: ["https://app.mento.org/_next/static/chunks/app.js"],
    });

    expect(filterNoisySentryEvents(event)).toBe(event);
  });

  it("keeps shared-environment errors when server-side first-party frames are present", () => {
    const event = makeEvent({
      exceptionValue: "Maximum call stack size exceeded",
      frames: ["/var/task/.next/server/app/pools/page.js"],
    });

    expect(filterNoisySentryEvents(event)).toBe(event);
  });

  it("drops chunk-load errors only when they come from extension frames", () => {
    const event = makeEvent({
      exceptionValue: "ChunkLoadError: Failed to load chunk",
      frames: ["chrome-extension://wallet/content.js"],
    });

    expect(filterNoisySentryEvents(event)).toBeNull();
  });

  it("keeps chunk-load errors with first-party frames", () => {
    const event = makeEvent({
      exceptionValue:
        "Failed to load chunk /_next/static/chunks/261662b5506ccddd.js",
      frames: ["https://app.mento.org/_next/static/chunks/main.js"],
    });

    expect(filterNoisySentryEvents(event)).toBe(event);
  });

  it("falls back to a string originalException when the event message is empty", () => {
    const event = makeEvent();
    const hint = { originalException: "Origin not allowed" } as EventHint;

    expect(filterNoisySentryEvents(event, hint)).toBeNull();
  });

  it("falls back to an Error originalException when the event message is empty", () => {
    const event = makeEvent();
    const hint = {
      originalException: new Error("Origin not allowed"),
    } as EventHint;

    expect(filterNoisySentryEvents(event, hint)).toBeNull();
  });
});
