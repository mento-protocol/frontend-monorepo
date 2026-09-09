import { cleanup, render, screen } from "@testing-library/react";
import type { ElementType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

interface DayPickerMockProps {
  className?: string;
  components: {
    Chevron: ElementType;
    DayButton: ElementType;
    Root: ElementType;
    WeekNumber: ElementType;
  };
  formatters: {
    formatMonthDropdown: (date: Date) => ReactNode;
  };
}

vi.mock("react-day-picker", () => ({
  DayButton: () => null,
  getDefaultClassNames: () => ({}),
  DayPicker: (props: DayPickerMockProps) => {
    const { Root, Chevron, DayButton, WeekNumber } = props.components;
    const date = new Date(2026, 8, 8);
    const formattedMonth = props.formatters.formatMonthDropdown(date);
    return (
      <Root className={props.className}>
        <span>{formattedMonth}</span>
        {(["left", "right", "down", "up", undefined] as const).map(
          (orientation, index) => (
            <Chevron
              key={index}
              orientation={orientation}
              data-testid={`chevron-${index}`}
            />
          ),
        )}
        <DayButton day={{ date }} modifiers={{ selected: true, focused: true }}>
          single
        </DayButton>
        <DayButton
          day={{ date }}
          modifiers={{ selected: true, range_start: true }}
        >
          start
        </DayButton>
        <DayButton
          day={{ date }}
          modifiers={{ selected: true, range_end: true }}
        >
          end
        </DayButton>
        <DayButton
          day={{ date }}
          modifiers={{ selected: true, range_middle: true }}
        >
          middle
        </DayButton>
        <DayButton
          day={{ date }}
          modifiers={{ selected: false, focused: false }}
        >
          plain
        </DayButton>
        <table>
          <tbody>
            <tr>
              <WeekNumber>3</WeekNumber>
            </tr>
          </tbody>
        </table>
      </Root>
    );
  },
}));

import { Calendar } from "./calendar.js";

afterEach(cleanup);

describe("Calendar", () => {
  it("renders all navigation directions and day selection states", () => {
    render(<Calendar mode="single" />);

    expect(screen.getByText("Sep")).toBeTruthy();
    expect(screen.getAllByTestId(/^chevron-/)).toHaveLength(5);
    expect(
      screen.getByText("single").getAttribute("data-selected-single"),
    ).toBe("true");
    expect(screen.getByText("start").getAttribute("data-range-start")).toBe(
      "true",
    );
    expect(screen.getByText("end").getAttribute("data-range-end")).toBe("true");
    expect(screen.getByText("middle").getAttribute("data-range-middle")).toBe(
      "true",
    );
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("accepts dropdown captions and caller overrides", () => {
    render(
      <Calendar
        mode="single"
        captionLayout="dropdown"
        showOutsideDays={false}
        buttonVariant="outline"
        className="custom-calendar"
        classNames={{ root: "custom-root" }}
        formatters={{ formatMonthDropdown: () => "Custom month" }}
        components={{
          Root: ({ children, ...props }) => (
            <section data-testid="custom-root" {...props}>
              {children}
            </section>
          ),
        }}
      />,
    );

    expect(screen.getByText("Custom month")).toBeTruthy();
    expect(screen.getByTestId("custom-root").className).toContain(
      "custom-calendar",
    );
  });
});
