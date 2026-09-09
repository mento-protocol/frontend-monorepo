import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-chart">{children}</div>
  ),
}));

import { ChartContainer } from "./chart.js";

afterEach(cleanup);

describe("ChartContainer", () => {
  it("creates a stable chart id and color variables", () => {
    const { container } = render(
      <ChartContainer
        id="reserves"
        className="custom-chart"
        config={{
          celo: { label: "CELO", color: "#35d07f" },
          empty: { label: "No color" },
        }}
      >
        <svg aria-label="Reserve data" />
      </ChartContainer>,
    );

    const chart = container.querySelector('[data-chart="chart-reserves"]');
    expect(chart?.className).toContain("custom-chart");
    expect(screen.getByLabelText("Reserve data")).toBeTruthy();
    expect(container.querySelector("style")?.textContent).toContain(
      "--color-celo: #35d07f;",
    );
    expect(container.querySelector("style")?.textContent).not.toContain(
      "--color-empty",
    );
  });

  it("emits light and dark theme variables", () => {
    const { container } = render(
      <ChartContainer
        config={{
          themed: { theme: { light: "white", dark: "black" } },
        }}
      >
        <svg />
      </ChartContainer>,
    );

    const chartId = container.firstElementChild?.getAttribute("data-chart");
    expect(chartId).toMatch(/^chart-/);
    const styles = container.querySelector("style")?.textContent;
    expect(styles).toContain("--color-themed: white;");
    expect(styles).toContain("--color-themed: black;");
    expect(styles).toContain(".dark");
  });

  it("omits styles when the configuration has no colors", () => {
    const { container } = render(
      <ChartContainer config={{ value: {} }}>
        <svg />
      </ChartContainer>,
    );

    expect(container.querySelector("style")).toBeNull();
  });
});
