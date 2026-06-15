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

function isElementBefore(left: Element, right: Element): boolean {
  return Boolean(
    left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function isBetweenAssetPickers(
  button: HTMLButtonElement,
  sourceAssetPicker: HTMLElement,
  destinationAssetPicker: HTMLElement,
): boolean {
  return (
    (isElementBefore(sourceAssetPicker, button) &&
      isElementBefore(button, destinationAssetPicker)) ||
    (isElementBefore(destinationAssetPicker, button) &&
      isElementBefore(button, sourceAssetPicker))
  );
}

function getSwapDirectionButton(root: HTMLElement): HTMLButtonElement | null {
  const sourceAssetPicker = root.querySelector<HTMLElement>(
    '[data-testid="source-asset-picker"]',
  );
  const destinationAssetPicker = root.querySelector<HTMLElement>(
    '[data-testid="dest-asset-picker"]',
  );

  if (!sourceAssetPicker || !destinationAssetPicker) return null;

  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
    if (compactText(button) || button.getAttribute("aria-label")) continue;
    if (
      isBetweenAssetPickers(button, sourceAssetPicker, destinationAssetPicker)
    ) {
      return button;
    }
  }

  return null;
}

export function patchBridgeWidgetAccessibility(root: HTMLElement) {
  normalizeAssetPicker(root, "source-asset-picker", "Select source asset");
  normalizeAssetPicker(root, "dest-asset-picker", "Select destination asset");

  const swapDirectionButton = getSwapDirectionButton(root);
  if (swapDirectionButton) {
    setAttributeIfChanged(
      swapDirectionButton,
      "aria-label",
      "Swap source and destination",
    );
    setAttributeIfChanged(
      swapDirectionButton,
      "title",
      "Swap source and destination",
    );
  }

  const wormholeLink = root.querySelector<HTMLAnchorElement>(
    'a[href*="wormhole.com/products/connect"]',
  );
  if (wormholeLink && !compactText(wormholeLink)) {
    setAttributeIfChanged(wormholeLink, "aria-label", "Wormhole Connect");
    setAttributeIfChanged(wormholeLink, "title", "Wormhole Connect");
  }
}
