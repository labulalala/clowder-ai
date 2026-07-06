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

  it('shows a variable expand/collapse toggle in a project toolbar only on the project tab', async () => {
    await harness.render();

    // Default (recent) tab is flat — no project toolbar.
    expect(harness.container.querySelector('[data-testid="sidebar-project-toolbar"]')).toBeNull();

    // Project tab has collapsible project groups → toolbar with a single variable button.
    await clickTab(harness.container, 'project', harness.flush);
    const toolbar = harness.container.querySelector('[data-testid="sidebar-project-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.textContent).toContain('项目 ·');

    // Variable button: exactly one of expand-all-btn / collapse-all-btn is present.
    const expand = harness.container.querySelector('[data-testid="expand-all-btn"]');
    const collapse = harness.container.querySelector('[data-testid="collapse-all-btn"]');
    const presentCount = (expand ? 1 : 0) + (collapse ? 1 : 0);
    expect(presentCount).toBe(1);
    const btn = (expand ?? collapse) as HTMLButtonElement | null;
    // Button carries a text label (not icon-only) — co-creator asked for visible affordance.
    expect(btn?.textContent?.trim().length).toBeGreaterThan(0);
    const label = btn?.getAttribute('aria-label') ?? '';
    expect(label === '展开全部项目' || label === '折叠全部项目').toBe(true);

    const tabContent = harness.container.querySelector('[data-testid="sidebar-tab-content"]');
    expect(tabContent?.className).toContain('pt-1.5');
  });

  it('scrolls the active tab into view after selection', async () => {
    await harness.render();

    await clickTab(harness.container, 'favorites', harness.flush);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
});
