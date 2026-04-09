import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

const useSanctionsCheckMock = vi.fn();

vi.mock("@/hooks/use-sanctions-check", () => ({
  useSanctionsCheck: () => useSanctionsCheckMock(),
}));

import { SanctionsGuard } from "./sanctions-guard";

afterEach(() => {
  cleanup();
  useSanctionsCheckMock.mockReset();
});

function renderGuard() {
  return render(
    React.createElement(
      SanctionsGuard,
      null,
      React.createElement("div", { "data-testid": "app-content" }, "App"),
    ),
  );
}

describe("SanctionsGuard", () => {
  it("renders children when address is clean", () => {
    useSanctionsCheckMock.mockReturnValue({
      isSanctioned: false,
      isChecking: false,
      checkFailed: false,
    });

    renderGuard();

    expect(screen.queryByTestId("app-content")).not.toBeNull();
    expect(screen.queryByText("Access Restricted")).toBeNull();
    expect(screen.queryByText("Compliance Check Unavailable")).toBeNull();
  });

  it("renders children while checking", () => {
    useSanctionsCheckMock.mockReturnValue({
      isSanctioned: false,
      isChecking: true,
      checkFailed: false,
    });

    renderGuard();

    expect(screen.queryByTestId("app-content")).not.toBeNull();
  });

  it("renders blocked screen and hides children for sanctioned address", () => {
    useSanctionsCheckMock.mockReturnValue({
      isSanctioned: true,
      isChecking: false,
      checkFailed: false,
    });

    renderGuard();

    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(screen.queryByText("App")).toBeNull();
    expect(screen.queryByText("Access Restricted")).not.toBeNull();
    expect(screen.queryByText(/identified on a sanctions list/)).not.toBeNull();
    // Verify it's not the error screen
    expect(screen.queryByText("Compliance Check Unavailable")).toBeNull();
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("renders error screen with retry when check fails", () => {
    useSanctionsCheckMock.mockReturnValue({
      isSanctioned: false,
      isChecking: false,
      checkFailed: true,
    });

    renderGuard();

    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(screen.queryByText("Compliance Check Unavailable")).not.toBeNull();
    expect(screen.queryByText("Retry")).not.toBeNull();
    // Verify it's not the sanctioned screen
    expect(screen.queryByText("Access Restricted")).toBeNull();
  });
});
