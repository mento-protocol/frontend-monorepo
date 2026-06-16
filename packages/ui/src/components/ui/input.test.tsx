import type { ComponentProps } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "@/components/ui/input.js";

const cases: { name: string; props: ComponentProps<"input"> }[] = [
  { name: "default", props: {} },
  { name: "text", props: { type: "text", placeholder: "Search" } },
  { name: "disabled", props: { disabled: true } },
  { name: "invalid", props: { "aria-invalid": true } },
];

describe("Input", () => {
  it.each(cases)("renders the $name state unchanged", ({ props }) => {
    const { container } = render(<Input {...props} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
