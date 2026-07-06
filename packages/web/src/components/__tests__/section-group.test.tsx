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

// v10: pin button moved into "更多操作" menu per co-creator request.
// Tests now verify pin via the menu item (native <button>, Space/Enter supported).

/** Open the "更多操作" dropdown menu and return it. Throws if absent — fail fast. */
function openMenu(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('[data-testid="project-menu-btn"]');
  if (!btn) throw new Error('project-menu-btn not found');
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return btn;
}

/** Find the "固定项目" menu item inside the open menu. Throws if absent. */
function findPinItem(container: HTMLElement): HTMLButtonElement {
  const item = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('固定项目'));
  if (!item) throw new Error('pin menu item not found');
  return item;
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

describe('SectionGroup pin (in 更多操作 menu)', () => {
  it('fires onToggleProjectPin when menu item is clicked', () => {
    const onPin = vi.fn();
    const { container } = renderPinGroup({ onPin });
    openMenu(container);
    const pinItem = findPinItem(container);
    act(() => {
      pinItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it('pin menu item click does not trigger parent onToggle', () => {
    const onToggle = vi.fn();
    const onPin = vi.fn();
    const { container } = renderPinGroup({ onToggle, onPin });
    openMenu(container);
    const pinItem = findPinItem(container);
    act(() => {
      pinItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('shows "取消固定项目" label when already pinned', () => {
    const { container } = renderPinGroup({ isProjectPinned: true });
    openMenu(container);
    const pinItem = findPinItem(container);
    expect(pinItem.textContent).toBe('取消固定项目');
  });

  it('pin menu item is a native button (keyboard-accessible by default)', () => {
    const onPin = vi.fn();
    const { container } = renderPinGroup({ onPin });
    openMenu(container);
    const pinItem = findPinItem(container);
    // Native <button> is keyboard-accessible by default (Space/Enter trigger click).
    // jsdom doesn't simulate the Enter→click synthesis, so we verify the element is a
    // native button (tagName) rather than a div — that's what guarantees keyboard support.
    expect(pinItem.tagName).toBe('BUTTON');
    act(() => {
      pinItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPin).toHaveBeenCalledTimes(1);
  });
});
