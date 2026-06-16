import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge.js";

const variants = ["default", "secondary", "destructive", "outline"] as const;

describe("Badge", () => {
  it.each(variants)("renders the %s variant unchanged", (variant) => {
    const { container } = render(<Badge variant={variant}>Badge</Badge>);
    expect(container.firstChild).toMatchSnapshot();
  });
});
