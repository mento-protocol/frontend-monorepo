import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, type ButtonProps } from "@/components/ui/button.js";

// Isolated per-component renders keep useId() stable and the diffs readable.
// A logic-only PR must leave each of these snapshots byte-identical.
const cases: { name: string; props: ButtonProps }[] = [
  { name: "default", props: {} },
  { name: "secondary", props: { variant: "secondary" } },
  { name: "outline", props: { variant: "outline" } },
  { name: "destructive", props: { variant: "destructive" } },
  { name: "ghost", props: { variant: "ghost" } },
  { name: "link", props: { variant: "link" } },
  { name: "size-sm", props: { size: "sm" } },
  { name: "size-lg", props: { size: "lg" } },
  { name: "disabled", props: { disabled: true } },
];

describe("Button", () => {
  it.each(cases)("renders the $name variant unchanged", ({ props }) => {
    const { container } = render(<Button {...props}>Label</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("exposes an accessible button role with its label", () => {
    const { getByRole } = render(<Button>Submit</Button>);
    const button = getByRole("button", { name: "Submit" });
    expect(button.tagName).toBe("BUTTON");
  });
});
