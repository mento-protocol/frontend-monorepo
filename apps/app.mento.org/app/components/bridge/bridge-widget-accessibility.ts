function compactText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function setAttributeIfChanged(element: Element, name: string, value: string) {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function normalizeAssetPicker(
  root: HTMLElement,
  testId: string,
  fallbackLabel: string,
) {
  const picker = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!picker) return;

  const label = picker.getAttribute("aria-label")?.trim() || fallbackLabel;
  setAttributeIfChanged(picker, "aria-label", label);
}

export function patchBridgeWidgetAccessibility(root: HTMLElement) {
  normalizeAssetPicker(root, "source-asset-picker", "Select source asset");
  normalizeAssetPicker(root, "dest-asset-picker", "Select destination asset");

  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
    if (compactText(button) || button.getAttribute("aria-label")) continue;

    setAttributeIfChanged(button, "aria-label", "Swap source and destination");
    setAttributeIfChanged(button, "title", "Swap source and destination");
  }

  const wormholeLink = root.querySelector<HTMLAnchorElement>(
    'a[href*="wormhole.com/products/connect"]',
  );
  if (wormholeLink && !compactText(wormholeLink)) {
    setAttributeIfChanged(wormholeLink, "aria-label", "Wormhole Connect");
    setAttributeIfChanged(wormholeLink, "title", "Wormhole Connect");
  }
}
