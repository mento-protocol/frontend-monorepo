import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  pause: vi.fn(),
  setTheme: vi.fn(),
  theme: "light",
  toastSuccess: vi.fn(),
}));

vi.mock("animejs", () => ({
  createTimeline: vi.fn(() => {
    const timeline = { add: mocks.add, pause: mocks.pause };
    mocks.add.mockReturnValue(timeline);
    return timeline;
  }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess },
  Toaster: (props: Record<string, unknown>) => (
    <div data-testid="sonner" data-theme={props.theme as string} />
  ),
}));

import { CopyToClipboard } from "./copy-to-clipboard.js";
import { Footer } from "./footer.js";
import Check from "./icons/check.js";
import Chevron from "./icons/chevron.js";
import Discord from "./icons/discord.js";
import Github from "./icons/github.js";
import Info from "./icons/info.js";
import Loading from "./icons/loading.js";
import Mento from "./icons/mento.js";
import X from "./icons/x.js";
import { Logo } from "./logo.js";
import { ModeToggle } from "./mode-toggle.js";
import { Navigation } from "./navigation.js";
import { TokenIcon } from "./token-icon.js";
import { Toaster } from "./ui/sonner.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.theme = "light";
});

describe("shared components", () => {
  it("copies text, shows confirmation, and restores the copy icon", () => {
    vi.useFakeTimers();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <CopyToClipboard
        text="0x1234"
        toastMsg="Copied"
        ariaLabel="Copy account"
        className="custom-copy"
      />,
    );

    const button = screen.getByRole("button", { name: "Copy account" });
    fireEvent.click(button);

    expect(writeText).toHaveBeenCalledWith("0x1234");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Copied", {
      duration: 2000,
    });
    expect(button.querySelector(".lucide-check")).toBeTruthy();

    act(() => vi.runAllTimers());
    expect(button.querySelector(".lucide-copy")).toBeTruthy();
  });

  it("uses the default copy message and reports clipboard failures", () => {
    const error = new Error("clipboard unavailable");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => {
          throw error;
        },
      },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(<CopyToClipboard text="value" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    expect(consoleError).toHaveBeenCalledWith("Failed to copy address", error);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([
    ["swap", true, true, false],
    ["reserve", false, true, true],
    ["governance", true, false, true],
  ] as const)(
    "renders the %s footer destinations",
    (type, hasReserve, hasGovernance, hasApp) => {
      render(<Footer type={type} />);

      expect(Boolean(screen.queryByRole("link", { name: "Reserve" }))).toBe(
        hasReserve,
      );
      expect(Boolean(screen.queryByRole("link", { name: "Governance" }))).toBe(
        hasGovernance,
      );
      expect(Boolean(screen.queryByRole("link", { name: "Mento App" }))).toBe(
        hasApp,
      );
    },
  );

  it("uses the swap footer by default", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "Reserve" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Discord" }).getAttribute("href"),
    ).toBe("https://discord.mento.org");
  });

  it("toggles light and dark themes", () => {
    const { rerender } = render(<ModeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(mocks.setTheme).toHaveBeenLastCalledWith("dark");

    mocks.theme = "dark";
    rerender(<ModeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(mocks.setTheme).toHaveBeenLastCalledWith("light");
  });

  it("renders token images, fallbacks, and a missing-token marker", () => {
    const { rerender } = render(<TokenIcon token={null} />);
    expect(screen.getByText("?")).toBeTruthy();

    rerender(
      <TokenIcon
        token={{ address: "0x1", symbol: "celo" }}
        className="token"
        size={32}
      />,
    );
    const image = document.querySelector("img.token") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/tokens/celo.svg");
    expect(image.getAttribute("width")).toBe("32");
    fireEvent.error(image);
    expect(screen.getByText("CE")).toBeTruthy();

    rerender(
      <TokenIcon key="short-symbol" token={{ address: "0x2", symbol: "X" }} />,
    );
    fireEvent.error(document.querySelector("img")!);
    expect(screen.queryByText("CE")).toBeNull();
  });

  it("renders icon defaults and custom presentation", () => {
    const { unmount } = render(
      <>
        <Check data-testid="check-default" />
        <Check data-testid="check-custom" fill="red" />
        <Chevron data-testid="chevron-default" />
        <Chevron data-testid="chevron-custom" fill="blue" />
        <Discord data-testid="discord-default" />
        <Discord
          data-testid="discord-custom"
          width={12}
          height={13}
          color="red"
        />
        <Github data-testid="github-default" />
        <Github
          data-testid="github-custom"
          width={14}
          height={15}
          color="blue"
        />
        <X data-testid="x-default" />
        <X data-testid="x-custom" width={16} height={17} color="green" />
        <Info />
        <span data-testid="mento-default">
          <Mento />
        </span>
        <span data-testid="mento-custom">
          <Mento
            width={30}
            height={31}
            backgroundColor="primary"
            logoColor="fill-white"
          />
        </span>
        <Logo data-testid="logo" />
      </>,
    );

    expect(
      screen
        .getByTestId("check-custom")
        .querySelector("path")
        ?.getAttribute("fill"),
    ).toBe("red");
    expect(screen.getByTestId("discord-custom").getAttribute("width")).toBe(
      "12",
    );
    expect(
      screen
        .getByTestId("mento-custom")
        .querySelector("svg")
        ?.getAttribute("height"),
    ).toBe("31");
    expect(screen.getByTitle("Mento Logo")).toBeTruthy();
    unmount();
  });

  it("starts and stops the loading animation", () => {
    const { unmount } = render(<Loading data-testid="loading" />);
    expect(screen.getByTestId("loading").querySelectorAll("rect")).toHaveLength(
      3,
    );
    expect(mocks.add).toHaveBeenCalledTimes(4);

    unmount();
    expect(mocks.pause).toHaveBeenCalledTimes(1);
  });

  it("renders navigation and forwards the active theme to the toaster", () => {
    const { rerender } = render(
      <>
        <Navigation />
        <Toaster position="top-right" />
      </>,
    );
    expect(
      screen.getByRole("link", { name: /Mento Logo/ }).getAttribute("href"),
    ).toBe("https://mento.org");
    expect(
      screen.getByRole("link", { name: "Launch App" }).getAttribute("href"),
    ).toBe("https://app.mento.org");
    expect(screen.getByTestId("sonner").getAttribute("data-theme")).toBe(
      "light",
    );

    mocks.theme = undefined as unknown as string;
    rerender(<Toaster />);
    expect(screen.getByTestId("sonner").getAttribute("data-theme")).toBe(
      "system",
    );
  });
});
