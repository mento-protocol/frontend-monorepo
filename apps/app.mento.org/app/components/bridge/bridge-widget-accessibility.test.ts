import { describe, expect, it } from "vitest";

import { patchBridgeWidgetAccessibility } from "./bridge-widget-accessibility";

describe("patchBridgeWidgetAccessibility", () => {
  it("preserves existing asset picker labels", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-testid="source-asset-picker" aria-label="Select source asset">USDm</button>
      <button data-testid="dest-asset-picker" aria-label="Select destination asset">GBPm</button>
    `;

    patchBridgeWidgetAccessibility(root);

    expect(
      root
        .querySelector('[data-testid="source-asset-picker"]')
        ?.getAttribute("aria-label"),
    ).toBe("Select source asset");
    expect(
      root
        .querySelector('[data-testid="dest-asset-picker"]')
        ?.getAttribute("aria-label"),
    ).toBe("Select destination asset");
  });

  it("adds specific fallback labels with selected assets when the widget omits them", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-testid="source-asset-picker">USDm</button>
      <button data-testid="dest-asset-picker">GBPm</button>
    `;

    patchBridgeWidgetAccessibility(root);

    expect(
      root
        .querySelector('[data-testid="source-asset-picker"]')
        ?.getAttribute("aria-label"),
    ).toBe("Select source asset: USDm");
    expect(
      root
        .querySelector('[data-testid="dest-asset-picker"]')
        ?.getAttribute("aria-label"),
    ).toBe("Select destination asset: GBPm");
  });

  it("labels the unlabeled swap button between asset pickers", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-testid="source-asset-picker">USDm</button>
      <button id="swap-direction"><svg /></button>
      <button data-testid="dest-asset-picker">GBPm</button>
    `;

    patchBridgeWidgetAccessibility(root);

    const swapButton = root.querySelector("#swap-direction");
    expect(swapButton?.getAttribute("aria-label")).toBe(
      "Swap source and destination",
    );
    expect(swapButton?.getAttribute("title")).toBe(
      "Swap source and destination",
    );
  });

  it("does not label unrelated unlabeled icon buttons", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button id="dialog-close"><svg /></button>
      <button data-testid="source-asset-picker">USDm</button>
      <button id="swap-direction"><svg /></button>
      <button data-testid="dest-asset-picker">GBPm</button>
      <button id="settings"><svg /></button>
    `;

    patchBridgeWidgetAccessibility(root);

    expect(
      root.querySelector("#dialog-close")?.hasAttribute("aria-label"),
    ).toBe(false);
    expect(root.querySelector("#settings")?.hasAttribute("aria-label")).toBe(
      false,
    );
    expect(
      root.querySelector("#swap-direction")?.getAttribute("aria-label"),
    ).toBe("Swap source and destination");
  });
});
