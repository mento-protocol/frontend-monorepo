import * as Sentry from "@sentry/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("reportSubgraphError", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("groups by query and error message, not by stack frames", async () => {
    const { reportSubgraphError } = await import("./report-subgraph-error");
    const error = new TypeError("Failed to fetch (api.studio.thegraph.com)");

    reportSubgraphError(error, "GetProposals");

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      fingerprint: [
        "governance-subgraph",
        "GetProposals",
        "TypeError",
        "Failed to fetch (api.studio.thegraph.com)",
      ],
      tags: { context: "governance-subgraph", queryName: "GetProposals" },
    });
  });
});
