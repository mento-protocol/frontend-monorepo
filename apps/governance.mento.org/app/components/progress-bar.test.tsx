// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resize = vi.fn();
class ResizeObserverMock {
  observe = resize;
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.mock("@mento-protocol/ui", () => ({
  cn: (...values: unknown[]) => values.flat(3).filter(Boolean).join(" "),
}));

import { ProgressBar } from "./progress-bar";

beforeEach(() => {
  resize.mockClear();
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 600,
  });
});
afterEach(cleanup);

describe("ProgressBar", () => {
  it("renders yes, no, and abstain votes", () => {
    const { container } = render(
      <ProgressBar
        mode="vote"
        data={{
          mode: "vote",
          approve: { value: "60", percentage: 60 },
          reject: { value: "20", percentage: 20 },
          abstain: { value: "20", percentage: 20 },
        }}
      />,
    );
    expect(screen.getByText("Yes:")).toBeTruthy();
    expect(screen.getByText("Abstain:")).toBeTruthy();
    expect(screen.getByText("No:")).toBeTruthy();
    expect(container.querySelectorAll(".bg-success").length).toBeGreaterThan(0);
    expect(resize).toHaveBeenCalled();
  });

  it("centers a dominant abstain vote", () => {
    const { container } = render(
      <ProgressBar
        mode="vote"
        data={{
          mode: "vote",
          approve: { value: "5", percentage: 5 },
          reject: { value: "5", percentage: 5 },
          abstain: { value: "90", percentage: 90 },
        }}
      />,
    );
    expect(container.querySelectorAll(".bg-muted").length).toBeGreaterThan(0);
  });

  it("renders unfilled quorum segments", () => {
    const { container } = render(
      <ProgressBar
        quorumNotMet
        mode="vote"
        data={{
          mode: "vote",
          approve: { value: "10", percentage: 10 },
          reject: { value: "5", percentage: 5 },
          totalQuorum: 100,
        }}
      />,
    );
    expect(container.querySelector(".quorum-not-met")).toBeTruthy();
    expect(container.querySelectorAll(".bg-white").length).toBeGreaterThan(0);
  });

  it("renders time progress with a partial selected segment", () => {
    const { container } = render(
      <ProgressBar
        className="custom"
        mode="time"
        data={{
          mode: "time",
          labels: { start: "Start", middle: "Middle", end: "End" },
          currentValue: 1,
          maxValue: 3,
          valueLabel: "One day",
        }}
      />,
    );
    expect(screen.getByText("One day")).toBeTruthy();
    expect(container.querySelector(".h-3")).toBeTruthy();
    expect(container.querySelector(".custom")).toBeTruthy();
  });

  it("renders time progress without a partial or label", () => {
    render(
      <ProgressBar
        mode="time"
        data={{
          mode: "time",
          labels: { start: "A", middle: "B", end: "C" },
          currentValue: 1,
          maxValue: 2,
        }}
      />,
    );
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("rejects mismatched data", () => {
    const { container } = render(
      <ProgressBar
        mode="vote"
        data={{
          mode: "time",
          labels: { start: "A", middle: "B", end: "C" },
          currentValue: 1,
          maxValue: 2,
        }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
