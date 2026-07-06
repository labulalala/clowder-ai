import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { SectionGroup } from '../ThreadSidebar/SectionGroup';

function renderToContainer(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

// v11: pin button restored to a常驻 sec-action next to "更多操作" (per demo line 505).
// Tests verify pin via the standalone pin button (testId="project-pin-btn").

/** Find the standalone pin button. Throws if absent — fail fast. */
function findPinBtn(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('[data-testid="project-pin-btn"]');
  if (!btn) throw new Error('project-pin-btn not found');
  return btn;
}

function renderPinGroup(overrides: { onToggle?: () => void; onPin?: () => void; isProjectPinned?: boolean } = {}) {
  const onPin = overrides.onPin ?? vi.fn();
  const { container } = renderToContainer(
    <SectionGroup
      label="test-project"
      count={3}
      isCollapsed={false}
      onToggle={overrides.onToggle ?? (() => {})}
      onToggleProjectPin={onPin}
      isProjectPinned={overrides.isProjectPinned ?? false}
    >
      <div>child</div>
    </SectionGroup>,
  );
  return { container, onPin };
}

describe('SectionGroup pin button (常驻 sec-action)', () => {
  it('fires onToggleProjectPin on click', () => {
    const onPin = vi.fn();
    const { container } = renderPinGroup({ onPin });
    const pinBtn = findPinBtn(container);
    act(() => {
      pinBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it('pin button click does not trigger parent onToggle', () => {
    const onToggle = vi.fn();
    const onPin = vi.fn();
    const { container } = renderPinGroup({ onToggle, onPin });
    const pinBtn = findPinBtn(container);
    act(() => {
      pinBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('uses accent color when pinned, muted when unpinned', () => {
    const { container: unpinned } = renderPinGroup({ isProjectPinned: false });
    const unpinnedBtn = findPinBtn(unpinned);
    expect(unpinnedBtn.className).toContain('opacity-0'); // hidden until hover

    const { container: pinned } = renderPinGroup({ isProjectPinned: true });
    const pinnedBtn = findPinBtn(pinned);
    expect(pinnedBtn.className).toContain('text-cafe-accent');
    expect(pinnedBtn.className).not.toContain('opacity-0');
  });

  it('pin button is a native button (keyboard-accessible by default)', () => {
    const onPin = vi.fn();
    const { container } = renderPinGroup({ onPin });
    const pinBtn = findPinBtn(container);
    // Native <button> is keyboard-accessible by default (Space/Enter trigger click).
    // jsdom doesn't simulate the Enter→click synthesis, so we verify the element is a
    // native button (tagName) — that's what guarantees keyboard support.
    expect(pinBtn.tagName).toBe('BUTTON');
  });
});
