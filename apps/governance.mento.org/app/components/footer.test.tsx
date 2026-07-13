import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "@mento-protocol/ui";
import { afterEach, describe, expect, it } from "vitest";

describe("Governance footer external links", () => {
  afterEach(() => {
    cleanup();
  });

  it("links X, Github, and Discord to the expected destinations", () => {
    render(<Footer type="governance" />);

    expect(
      (screen.getByTestId("x-link-button") as HTMLAnchorElement).href,
    ).toBe("https://x.com/MentoLabs");
    expect(
      (screen.getByTestId("github-link-button") as HTMLAnchorElement).href,
    ).toBe("https://github.com/mento-protocol");
    expect(
      (screen.getByTestId("discord-link-button") as HTMLAnchorElement).href,
    ).toBe("http://discord.mento.org/");
  });

  it("links Mento.org, Reserve, and Privacy Policy to the expected destinations", () => {
    render(<Footer type="governance" />);

    expect(
      (screen.getByRole("link", { name: "Mento.org" }) as HTMLAnchorElement)
        .href,
    ).toBe("https://mento.org/");
    expect(
      (screen.getByRole("link", { name: "Reserve" }) as HTMLAnchorElement).href,
    ).toBe("https://reserve.mento.org/");
    expect(
      (
        screen.getByRole("link", {
          name: "Privacy Policy",
        }) as HTMLAnchorElement
      ).href,
    ).toBe("https://mento.org/privacy");
  });
});
