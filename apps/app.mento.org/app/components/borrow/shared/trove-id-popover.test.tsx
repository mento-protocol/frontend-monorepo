import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TroveIdPopover } from "./trove-id-popover";

describe("TroveIdPopover", () => {
  it("renders the popover trigger with an accessible touch target", () => {
    render(<TroveIdPopover troveId="0xabc123456789" />);

    const trigger = screen.getByRole("button", { name: "View trove ID" });

    expect(trigger.classList.contains("h-6")).toBe(true);
    expect(trigger.classList.contains("w-6")).toBe(true);
    expect(trigger.classList.contains("items-center")).toBe(true);
    expect(trigger.classList.contains("justify-center")).toBe(true);
  });
});
