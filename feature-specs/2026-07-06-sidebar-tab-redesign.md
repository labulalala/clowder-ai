# Sidebar Tab Redesign Implementation Plan

**Feature:** Current thread request — left ThreadSidebar redesign (`thread_mr7npab0e3e87ihf`, no F-id assigned)
**Goal:** Redesign the left conversation sidebar into a clearer tabbed navigation surface with compact rows, hidden row actions, and v9 design parity.
**Acceptance Criteria:** AC-1 through AC-17 below, copied from `docs/design/sidebar-proposals.html` v9 and the thread handoff.
**Architecture cell:** `thread-navigation`
**Map delta:** none
**Map delta why:** This changes the existing ThreadSidebar presentation and grouping selectors, without changing thread metadata ownership or API boundaries.
**Architecture:** Add a local tab view model on top of existing thread data and pin/favorite/label state. Keep lobby and label filtering as separate surfaces, and render tab-specific thread lists with the existing `ThreadItem` / `SectionGroup` action contracts.
**Tech Stack:** React, TypeScript, existing Zustand stores, Vitest, Playwright for visual verification.
**前端验证:** Yes — compare against `docs/design/sidebar-proposals.html` v9 and verify in a feature worktree browser.

---

## Finish Line

B definition: the left sidebar reads as `大厅` + label filter + tab row (`最近 / 项目 / 系统 / 收藏`) + compact thread list, matching v9 interaction rules while preserving existing create/delete/rename/pin/favorite/label/replay behavior.

Not building:
- No new backend API or persistent state.
- No label-as-tab behavior; labels remain a filter bar.
- No new project metadata model; project pin state remains `useProjectPins`.
- No changes to runtime / alpha / production data stores.

## Terminal Schema

```ts
type SidebarTabId = 'recent' | 'project' | 'system' | 'favorites';

interface SidebarTab {
  id: SidebarTabId;
  label: string;
  count: number;
}

interface SidebarThreadBucket {
  kind: 'flat' | 'project';
  threads: Thread[];
  projectGroups?: ThreadGroup[];
}
```

Derived values only. Do not store tab memberships outside React memoized selectors.

## Acceptance Criteria

1. Lobby stays above the tab row and is never part of any tab.
2. Tab order is `最近 / 项目 / 系统 / 收藏`, plain text, no icons.
3. Tabs are isolated: each tab shows only its own conversations.
4. Recent/system/favorites tabs are flat; project tab uses project sections only.
5. Thread title is 12px, single-line ellipsis; active row changes weight only, not size.
6. Title row does not show folder/project chips; full info stays in hover tooltip.
7. Delete, pin, favorite, labels, rename, export, replay, and cat settings stay under `...` menu.
8. Pinned threads use the existing pushpin mark, with no left accent rail.
9. Favorited threads show a gold filled star in every tab where they appear.
10. Pinned conversations float in `最近` and inside their current tab subsection.
11. Pinned projects only affect the project tab.
12. Recent tab sorts by time descending; other tab subitems sort alphabetically with pinned first.
13. Labels render as one compact tag button with tag icon, up to three color dots, and `+N`.
14. Label button height matches the 16px cat avatar height.
15. Expand/collapse controls live on the right side of the tab row, icon-only single chevrons.
16. Overflowing tabs scroll horizontally and the active tab scrolls into view.
17. The list area has top padding so the first item does not touch the tab divider.

## Task 1: Selector Tests for Tab Membership and Sorting

**Files:**
- Modify: `packages/web/src/components/ThreadSidebar/thread-utils.ts`
- Test: `packages/web/src/components/__tests__/thread-utils.test.ts`

**Step 1: Write failing tests**

Add tests for:
- `recent` excludes default and system threads, includes favorites, sorts pinned first then recent time.
- `system` contains only `systemKind` / `connectorHubState` threads.
- `favorites` contains all favorited non-default threads, pinned first then alphabetical.
- `project` excludes system threads, groups by full project path, pinned projects sort first, subitems pinned first then alphabetical.

**Step 2: Run red**

Run:

```bash
pnpm --filter @cat-cafe/web exec vitest run src/components/__tests__/thread-utils.test.ts
```

Expected: new tab selector tests fail because the selector does not exist yet.

**Step 3: Implement selector**

Add exported pure helpers in `thread-utils.ts`:
- `SidebarTabId`
- `SidebarTab`
- `buildSidebarTabs(...)`
- `buildSidebarTabContent(...)`

Reuse existing `ThreadGroup` where possible. Keep all grouping derived and deterministic.

**Step 4: Run green**

Run the same test command. Expected: all `thread-utils` tests pass.

## Task 2: ThreadItem Compact Row Contract

**Files:**
- Modify: `packages/web/src/components/ThreadSidebar/ThreadItem.tsx`
- Test: `packages/web/src/components/__tests__/thread-item-actions.test.tsx`
- Test: `packages/web/src/components/__tests__/thread-item-draft-badge.test.tsx`

**Step 1: Write failing tests**

Add assertions for:
- Pin and delete controls are no longer fixed row buttons.
- More menu still exposes pin/delete/favorite/label actions.
- Favorited rows render a visible filled star outside the menu.
- Label dots render as one 16px-high button/container with tag semantics and overflow count.
- Row tooltip still contains title, participants, project path, and time.

**Step 2: Run red**

Run:

```bash
pnpm --filter @cat-cafe/web exec vitest run src/components/__tests__/thread-item-actions.test.tsx src/components/__tests__/thread-item-draft-badge.test.tsx
```

Expected: tests that assert compact v9 row behavior fail on current implementation.

**Step 3: Implement minimal UI**

Update `ThreadItem`:
- Single-line 12px title.
- Move pin/delete into more menu.
- Add inline pin and favorite markers before title.
- Replace label chips with tag-icon + dots compact label button.
- Remove active left accent rail assumptions if present.

**Step 4: Run green**

Run the same test command. Expected: thread item tests pass.

## Task 3: Sidebar Tab Row and Content Rendering

**Files:**
- Modify: `packages/web/src/components/ThreadSidebar/ThreadSidebar.tsx`
- Modify: `packages/web/src/components/ThreadSidebar/SectionGroup.tsx`
- Test: `packages/web/src/components/ThreadSidebar/__tests__/thread-sidebar-tab-redesign.test.tsx`

**Step 1: Write failing tests**

Create a sidebar harness test that verifies:
- Lobby renders before the tab list.
- Tabs render in the required order.
- Selecting each tab changes visible content and does not mix system/project/favorite-only views.
- Expand/collapse buttons are icon-only controls in the tab row.
- Active tab has a ref target for scroll-into-view behavior.

**Step 2: Run red**

Run:

```bash
pnpm --filter @cat-cafe/web exec vitest run src/components/ThreadSidebar/__tests__/thread-sidebar-tab-redesign.test.tsx
```

Expected: test fails because the sidebar still renders grouped sections without tabs.

**Step 3: Implement tab UI**

Update `ThreadSidebar`:
- Add `activeTab` state.
- Use tab selector helpers from Task 1.
- Keep default/lobby item above tabs.
- Render `LabelFilterBar` as a filter above the list, not as tabs.
- Add tab row overflow with refs and `scrollIntoView({ inline: 'nearest', block: 'nearest' })` on active tab changes.
- Render flat tab content with `ThreadItem`; project tab with `SectionGroup`.

Update `SectionGroup` only as needed for project-tab compact heading and real button separation.

**Step 4: Run green**

Run the new tab test plus existing sidebar tests.

## Task 4: Visual Contract and Windows Path Guard

**Files:**
- Modify: `packages/web/src/components/__tests__/f190-visual-contract.test.ts`
- Test: `packages/web/src/components/__tests__/f190-visual-contract.test.ts`

**Step 1: Write failing guard if needed**

If v9 styling introduces a visual-contract issue or Windows path miss, add the minimal test expectation first.

**Step 2: Implement fix**

Keep typography token and no raw pixel-font rules intact. If the existing `/dev/` exclusion needs Windows compatibility, use `[\\/]dev[\\/]`.

**Step 3: Run**

```bash
pnpm --filter @cat-cafe/web exec vitest run src/components/__tests__/f190-visual-contract.test.ts
```

Expected: 279 visual-contract tests pass.

## Task 5: Quality Gate and Dogfood

**Files:**
- Evidence only: screenshots in temp evidence dir, no root artifacts.

**Step 1: Format and typecheck**

```bash
pnpm biome format --write packages/web/src/components/ThreadSidebar packages/web/src/components/__tests__/f190-visual-contract.test.ts
pnpm --filter @cat-cafe/web exec tsc --noEmit
```

**Step 2: Run targeted tests**

```bash
pnpm --filter @cat-cafe/web exec vitest run src/components/__tests__/thread-utils.test.ts src/components/__tests__/thread-item-actions.test.tsx src/components/__tests__/thread-item-draft-badge.test.tsx src/components/ThreadSidebar/__tests__/thread-sidebar-tab-redesign.test.tsx src/components/ThreadSidebar/__tests__/sidebar-mobile-close.test.ts src/components/ThreadSidebar/__tests__/thread-sidebar-create-error-toast.test.tsx src/components/ThreadSidebar/__tests__/thread-sidebar-mission-entry.test.tsx src/components/ThreadSidebar/__tests__/thread-sidebar-organize-flow.test.tsx src/components/ThreadSidebar/__tests__/thread-sidebar-scroll-memory.test.ts src/components/__tests__/f190-visual-contract.test.ts
```

**Step 3: Browser dogfood**

Run the feature worktree dev service on an isolated non-runtime port. Do not use `3003/3004`.

Verify against `docs/design/sidebar-proposals.html` v9:
- default desktop view
- each tab selected
- active rightmost tab fully visible
- first list item spacing
- more-menu actions

**Step 4: Review packet**

Request review from Blue-White Cat with:
- original requirement excerpt
- v9 demo path
- 17-point coverage table
- tests and browser evidence
- worktree path and branch

