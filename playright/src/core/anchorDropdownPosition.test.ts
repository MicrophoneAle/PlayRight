import { describe, expect, it } from 'vitest';
import { computeAnchorDropdownPosition } from './anchorDropdownPosition.ts';

const viewport = { width: 1280, height: 800 };

function anchorRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('computeAnchorDropdownPosition', () => {
  it('keeps a right-aligned panel inside the viewport horizontally', () => {
    const position = computeAnchorDropdownPosition(
      anchorRect(40, 48, 36, 36),
      { panelWidth: 240, viewportPadding: 16, viewport },
    );

    expect(position.right).toBeGreaterThanOrEqual(16);
    expect(position.right).toBeLessThanOrEqual(1280 - 240 - 16);
  });

  it('limits max height to the space below the anchor', () => {
    const position = computeAnchorDropdownPosition(anchorRect(700, 48, 36, 36), {
      minHeight: 160,
      viewportPadding: 16,
      viewport,
    });

    expect(position.maxHeight).toBe(800 - (48 + 36 + 8) - 16);
  });

  it('flips above the anchor when there is more room above than below', () => {
    const position = computeAnchorDropdownPosition(anchorRect(700, 720, 36, 36), {
      minHeight: 160,
      viewportPadding: 16,
      viewport,
    });

    expect(position.top).toBeLessThan(720);
    expect(position.maxHeight).toBeGreaterThanOrEqual(160);
  });
});
