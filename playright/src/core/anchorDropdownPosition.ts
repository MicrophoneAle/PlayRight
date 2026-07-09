export interface AnchorDropdownPosition {
  top: number;
  right: number;
  maxHeight: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface AnchorDropdownOptions {
  menuGap?: number;
  viewportPadding?: number;
  minHeight?: number;
  panelWidth?: number;
  viewport?: ViewportSize;
}

function getViewportSize(override?: ViewportSize): ViewportSize {
  if (override) {
    return override;
  }

  const visualViewport = window.visualViewport;
  return {
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
  };
}

/**
 * Position a fixed, right-aligned dropdown below an anchor while keeping it
 * inside the viewport and reserving a sensible scroll height.
 */
export function computeAnchorDropdownPosition(
  anchorRect: DOMRect,
  options: AnchorDropdownOptions = {},
): AnchorDropdownPosition {
  const menuGap = options.menuGap ?? 8;
  const viewportPadding = options.viewportPadding ?? 16;
  const minHeight = options.minHeight ?? 160;
  const panelWidth = options.panelWidth ?? 0;
  const { width: viewportWidth, height: viewportHeight } = getViewportSize(
    options.viewport,
  );

  let top = anchorRect.bottom + menuGap;
  let right = viewportWidth - anchorRect.right;

  if (panelWidth > 0) {
    const maxRight = viewportWidth - panelWidth - viewportPadding;
    right = Math.min(right, maxRight);
  }

  right = Math.max(viewportPadding, right);

  const availableBelow = viewportHeight - top - viewportPadding;
  const availableAbove = anchorRect.top - menuGap - viewportPadding;

  let maxHeight = Math.max(minHeight, availableBelow);

  if (availableBelow < minHeight && availableAbove > availableBelow) {
    maxHeight = Math.max(minHeight, availableAbove);
    top = anchorRect.top - menuGap - maxHeight;
  }

  top = Math.max(
    viewportPadding,
    Math.min(top, viewportHeight - viewportPadding - minHeight),
  );

  maxHeight = Math.max(
    minHeight,
    Math.min(maxHeight, viewportHeight - top - viewportPadding),
  );

  return { top, right, maxHeight };
}
