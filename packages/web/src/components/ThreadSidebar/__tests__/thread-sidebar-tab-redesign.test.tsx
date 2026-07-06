import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '@/stores/chat-types';
import {
  createThreadSidebarHarness,
  installThreadSidebarGlobals,
  mockStore,
  resetThreadSidebarGlobals,
  resetThreadSidebarMocks,
  type ThreadSidebarHarness,
} from './thread-sidebar-test-helpers';

const NOW = 1710000000000;

function makeThread(overrides: Partial<Thread> & { id: string }): Thread {
  return {
    projectPath: 'default',
    title: null,
    createdBy: 'user',
    participants: [],
    lastActiveAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function visibleThreadIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-thread-id]')).map(
    (node) => node.getAttribute('data-thread-id') ?? '',
  );
}

async function clickTab(container: HTMLElement, tabId: string, flush: () => Promise<void>) {
  const tab = container.querySelector(`[data-testid="sidebar-tab-${tabId}"]`) as HTMLButtonElement;
  await act(async () => {
    tab.click();
  });
  await flush();
}

describe('ThreadSidebar v9 tab redesign', () => {
  let harness: ThreadSidebarHarness;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installThreadSidebarGlobals();
    resetThreadSidebarMocks();
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });
    Object.assign(mockStore, {
      threads: [
        makeThread({ id: 'default', title: '大厅', lastActiveAt: NOW }),
        makeThread({ id: 'recent', title: 'Recent Thread', projectPath: '/proj/b', lastActiveAt: NOW - 1_000 }),
        makeThread({ id: 'project', title: 'Project Thread', projectPath: '/proj/a', lastActiveAt: NOW - 2_000 }),
        makeThread({
          id: 'favorite',
          title: 'Favorite Thread',
          favorited: true,
          projectPath: '/proj/a',
          lastActiveAt: NOW - 3_000,
        }),
        makeThread({ id: 'system', title: 'System Thread', systemKind: 'eval_domain', lastActiveAt: NOW - 4_000 }),
      ],
      currentThreadId: 'recent',
      threadStates: {},
      isLoadingThreads: false,
    });
    harness = createThreadSidebarHarness();
  });

  afterEach(() => {
    harness.cleanup();
    resetThreadSidebarGlobals();
    vi.restoreAllMocks();
  });

  it('keeps lobby above the tab row and renders tabs in the v9 order', async () => {
    await harness.render();

    const lobby = harness.container.querySelector('[data-thread-id="default"]');
    const tabsRow = harness.container.querySelector('[data-testid="sidebar-tabs-row"]');
    expect(lobby).not.toBeNull();
    expect(tabsRow).not.toBeNull();
    const position = lobby!.compareDocumentPosition(tabsRow!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const tabs = Array.from(harness.container.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent?.trim());
    expect(tabs).toEqual(['最近3', '项目3', '系统1', '收藏1']);
  });

  it('switches isolated tab content without mixing system/project/favorite views', async () => {
    await harness.render();

    expect(visibleThreadIds(harness.container)).toEqual(['default', 'recent', 'project', 'favorite']);

    await clickTab(harness.container, 'system', harness.flush);
    expect(visibleThreadIds(harness.container)).toEqual(['default', 'system']);

    await clickTab(harness.container, 'favorites', harness.flush);
    expect(visibleThreadIds(harness.container)).toEqual(['default', 'favorite']);
  });

  it('shows icon-only expand controls only on the project tab and gives the list top breathing room', async () => {
    await harness.render();

    // Default (recent) tab is flat — no collapsible sections, so no expand/collapse buttons.
    expect(harness.container.querySelector('[data-testid="expand-all-btn"]')).toBeNull();
    expect(harness.container.querySelector('[data-testid="collapse-all-btn"]')).toBeNull();

    // Project tab has collapsible project groups → buttons appear, icon-only.
    await clickTab(harness.container, 'project', harness.flush);
    const expand = harness.container.querySelector('[data-testid="expand-all-btn"]');
    const collapse = harness.container.querySelector('[data-testid="collapse-all-btn"]');
    expect(expand?.textContent?.trim()).toBe('');
    expect(collapse?.textContent?.trim()).toBe('');
    expect(expand?.getAttribute('aria-label')).toBe('全部展开');
    expect(collapse?.getAttribute('aria-label')).toBe('全部折叠');

    const tabContent = harness.container.querySelector('[data-testid="sidebar-tab-content"]');
    expect(tabContent?.className).toContain('pt-1.5');
  });

  it('scrolls the active tab into view after selection', async () => {
    await harness.render();

    await clickTab(harness.container, 'favorites', harness.flush);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});
