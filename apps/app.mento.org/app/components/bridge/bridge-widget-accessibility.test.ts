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

  it("adds specific fallback labels when the widget omits them", () => {
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
    ).toBe("Select source asset");
    expect(
      root
        .querySelector('[data-testid="dest-asset-picker"]')
        ?.getAttribute("aria-label"),
    ).toBe("Select destination asset");
  });
});
