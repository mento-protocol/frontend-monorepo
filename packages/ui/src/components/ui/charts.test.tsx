import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reducedMotion: false }));

vi.mock("../../hooks/use-prefers-reduced-motion.js", () => ({
  usePrefersReducedMotion: () => mocks.reducedMotion,
}));

vi.mock("./chart.js", () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
}));

vi.mock("recharts", () => ({
  Cell: (props: Record<string, unknown>) => (
    <span data-testid="cell" data-fill={props.fill as string} />
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Sector: (props: Record<string, unknown>) => (
    <span data-testid="sector" data-radius={String(props.outerRadius)} />
  ),
  Pie: (props: {
    children?: React.ReactNode;
    shape?: (value: Record<string, unknown>) => React.ReactNode;
    onMouseEnter?: (_value: unknown, index: number) => void;
    onMouseLeave?: () => void;
  }) => (
    <div data-testid="pie">
      {props.children}
      {props.shape?.({
        outerRadius: undefined,
        isActive: true,
        name: "first",
        payload: { color: "#abc" },
      })}
      {props.shape?.({
        outerRadius: 20,
        isActive: false,
        name: "first",
        payload: { color: "#abc" },
      })}
      {props.shape?.({
        outerRadius: 20,
        isActive: false,
        name: "other",
        payload: { color: "#123456" },
      })}
      <button type="button" onClick={() => props.onMouseEnter?.({}, 0)}>
        enter valid
      </button>
      <button type="button" onClick={() => props.onMouseEnter?.({}, 99)}>
        enter invalid
      </button>
      <button type="button" onClick={() => props.onMouseLeave?.()}>
        leave
      </button>
    </div>
  ),
}));

import { BalanceGauge } from "./balance-gauge.js";
import { ReserveChart } from "./reserve-chart.js";

afterEach(cleanup);

beforeEach(() => {
  mocks.reducedMotion = false;
});

const gaugeProps = {
  token0Percent: 33.3,
  token1Percent: 66.7,
  token0Reserves: "333K",
  token1Reserves: "667K",
  token0Symbol: "GBPm",
  token1Symbol: "USDm",
  exchangeRate: "1.33",
  inputSymbol: "GBPm",
  outputSymbol: "USDm",
};

describe("chart components", () => {
  it("renders a balance gauge with default colors and price context", () => {
    const { container } = render(
      <BalanceGauge {...gaugeProps} oraclePrice="1.30" poolPrice="1.42" />,
    );

    expect(screen.getByText("33.3%")).toBeTruthy();
    expect(screen.getByText(/Oracle: 1.30/)).toBeTruthy();
    expect(screen.getByText(/1 GBPm = 1.33 USDm/)).toBeTruthy();
    expect(
      container.querySelector("polygon")?.getAttribute("points"),
    ).toBeTruthy();
  });

  it("supports reduced motion, custom colors, and omitted price context", () => {
    mocks.reducedMotion = true;
    render(
      <BalanceGauge
        {...gaugeProps}
        primaryColor="#abc"
        secondaryColor="#123456"
        oraclePrice="1.30"
      />,
    );

    expect(screen.queryByText(/Oracle:/)).toBeNull();
    expect(
      screen.getAllByTestId("cell").map((cell) => cell.dataset.fill),
    ).toEqual(["#abc", "#123456"]);
  });

  it("shows an explicit empty-state class for missing reserve data", () => {
    const { rerender } = render(<ReserveChart data={[]} className="empty" />);
    expect(screen.getByText("No data to display.").className).toBe("empty");

    rerender(<ReserveChart data={undefined as never} />);
    expect(screen.getByText("No data to display.").className).toContain(
      "mx-auto",
    );
  });

  it("renders reserve segments, active values, and interaction callbacks", () => {
    const onActiveChanged = vi.fn();
    const data = [
      { name: "first", value: 25, color: "#abc" },
      { name: "second", value: 75, color: "#123456" },
      { name: "invalid", value: 10, color: "red" },
    ];
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <ReserveChart
        data={data}
        className="reserve"
        innerRingOpacity={0.5}
        activeSegment="first"
        onActiveChanged={onActiveChanged}
      />,
    );

    expect(screen.getByText("25.00%")).toBeTruthy();
    expect(screen.getAllByTestId("sector").length).toBeGreaterThanOrEqual(4);
    expect(
      screen.getAllByTestId("cell").map((cell) => cell.dataset.fill),
    ).toContain("rgba(170,187,204,0.5)");
    expect(consoleWarn).toHaveBeenCalledWith(
      "Invalid hex color format: red. Using default black.",
    );

    for (const button of screen.getAllByRole("button", {
      name: "enter valid",
    })) {
      fireEvent.click(button);
    }
    for (const button of screen.getAllByRole("button", {
      name: "enter invalid",
    })) {
      fireEvent.click(button);
    }
    for (const button of screen.getAllByRole("button", { name: "leave" })) {
      fireEvent.click(button);
    }
    expect(onActiveChanged).toHaveBeenCalledWith("first");
    expect(onActiveChanged).toHaveBeenCalledWith(undefined);
    consoleWarn.mockRestore();
  });

  it("hides a zero active value and permits an omitted callback", () => {
    mocks.reducedMotion = true;
    render(
      <ReserveChart
        data={[{ name: "zero", value: 0, color: "#000" }]}
        activeSegment="zero"
      />,
    );

    expect(screen.queryByText("0.00%")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "leave" })[0]!);
  });
});
