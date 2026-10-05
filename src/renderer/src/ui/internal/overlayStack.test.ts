import { describe, expect, it } from 'vitest';
import { createOverlayStack } from './overlayStack';

describe('overlay stack', () => {
  it('treats the most recently opened overlay as the top-most one', () => {
    const stack = createOverlayStack();
    const sheet = stack.register();
    expect(sheet.isTopMost()).toBe(true);

    const dialog = stack.register();
    expect(dialog.isTopMost()).toBe(true);
    expect(sheet.isTopMost()).toBe(false);
    expect(stack.size).toBe(2);
  });

  it('hands the top spot back when the upper overlay closes', () => {
    const stack = createOverlayStack();
    const sheet = stack.register();
    const dialog = stack.register();

    dialog.release();
    expect(sheet.isTopMost()).toBe(true);
    expect(dialog.isTopMost()).toBe(false);
    expect(stack.size).toBe(1);
  });

  it('copes with overlays closing out of order and with double release', () => {
    const stack = createOverlayStack();
    const first = stack.register();
    const second = stack.register();

    first.release();
    first.release();
    expect(second.isTopMost()).toBe(true);
    expect(stack.size).toBe(1);
  });
});
