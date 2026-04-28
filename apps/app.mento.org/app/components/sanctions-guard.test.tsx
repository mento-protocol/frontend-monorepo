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
    useSanctionsCheckMock.mockReturnValue({ isSanctioned: false });

    renderGuard();

    expect(screen.queryByTestId("app-content")).not.toBeNull();
    expect(screen.queryByText("Access Restricted")).toBeNull();
  });

  it("renders children while checking", () => {
    useSanctionsCheckMock.mockReturnValue({ isSanctioned: false });

    renderGuard();

    expect(screen.queryByTestId("app-content")).not.toBeNull();
  });

  it("renders blocked screen and hides children for sanctioned address", () => {
    useSanctionsCheckMock.mockReturnValue({ isSanctioned: true });

    renderGuard();

    expect(screen.queryByTestId("app-content")).toBeNull();
    expect(screen.queryByText("App")).toBeNull();
    expect(screen.queryByText("Access Restricted")).not.toBeNull();
    expect(screen.queryByText(/identified on a sanctions list/)).not.toBeNull();
  });
});
