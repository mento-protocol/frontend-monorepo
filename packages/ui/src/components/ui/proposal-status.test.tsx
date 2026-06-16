import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProposalStatus } from "@/components/ui/proposal-status.js";

const variants = [
  "default",
  "active",
  "pending",
  "executed",
  "queued",
  "succeeded",
  "defeated",
  "canceled",
] as const;

describe("ProposalStatus", () => {
  it.each(variants)("renders the %s variant unchanged", (variant) => {
    const { container } = render(<ProposalStatus variant={variant} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
