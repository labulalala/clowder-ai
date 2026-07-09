/**
 * F113 Phase D: Cross-platform directory browser.
 * Replaces macOS-only osascript folder picker with a web-based solution.
 * Calls GET /api/projects/browse to list directories.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import { apiFetch } from '@/utils/api-client';

interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface BrowseResult {
  current: string;
  name: string;
  parent: string | null;
  homePath: string;
  entries: BrowseEntry[];
}

interface DriveInfo {
  letter: string;
  path: string;
  label: string;
}

interface DirectoryBrowserProps {
  /** Initially browsed path — defaults to home via API */
  initialPath?: string;
  /** Path of the currently active project (highlighted in listing) */
  activeProjectPath?: string;
  /** Called whenever the browsed directory changes */
  onCurrentPathChange?: (path: string) => void;
  /** Called when user cancels */
  onCancel: () => void;
}

/**
 * Build breadcrumb segments for a Windows drive path (e.g. "D:\XXX").
 * The drive root is its own clickable segment so the user can navigate back
 * to "D:\" — without this, the drive letter layer is silently swallowed and
 * the breadcrumb reads "此电脑 > XXX" instead of "此电脑 > 本地磁盘 (D:) > XXX".
 * Drive root path keeps the trailing separator (realpath needs it to resolve
 * the drive rather than cwd-on-drive).
 */
function windowsDriveSegments(absPath: string, sep: string): { label: string; path: string }[] {
  const parts = absPath.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return [];

  const driveRoot = `${parts[0]}${sep}`;
  const segments: { label: string; path: string }[] = [{ label: parts[0], path: driveRoot }];
  let accumulated = driveRoot;
  for (let i = 1; i < parts.length; i++) {
    accumulated = accumulated.endsWith(sep) ? `${accumulated}${parts[i]}` : `${accumulated}${sep}${parts[i]}`;
    segments.push({ label: parts[i], path: accumulated });
  }
  return segments;
}

/**
 * Parse an absolute path into breadcrumb segments.
 * When path is under homePath: Home > relative segments (each clickable).
 * When path is outside homePath (e.g. /tmp, /Volumes): show the full path
 * segments from the allowed root, using the parent field for "go up".
 * Handles both / and \ separators for cross-platform support.
 */
function pathToSegments(absPath: string, homePath: string): { label: string; path: string }[] {
  const sep = absPath.includes('\\') ? '\\' : '/';

  // Case 1: path is at or under home — use "Home" as root label
  if (absPath === homePath || absPath.startsWith(homePath + sep)) {
    const segments: { label: string; path: string }[] = [{ label: 'Home', path: '' }];
    if (absPath === homePath) return segments;

    const relative = absPath.slice(homePath.length + 1);
    if (!relative) return segments;

    const parts = relative.split(/[/\\]/).filter(Boolean);
    let accumulated = homePath;
    for (const part of parts) {
      accumulated += sep + part;
      segments.push({ label: part, path: accumulated });
    }
    return segments;
  }

  // Case 2: path is outside home — all segments are clickable.
  // We can't know the full allowlist on the frontend. If the user clicks
  // a non-allowed ancestor, the backend returns 403 and the error is shown
  // gracefully. This is better than hiding valid ancestors like /tmp which
  // IS in the default allowlist (project-path.ts:22-35).
  if (/^[A-Za-z]:[\\/]?/.test(absPath)) {
    return windowsDriveSegments(absPath, sep);
  }

  const parts = absPath.split(/[/\\]/).filter(Boolean);
  const segments: { label: string; path: string }[] = [];
  let accumulated = absPath.startsWith('/') ? '' : parts[0];
  const startIdx = absPath.startsWith('/') ? 0 : 1;
  for (let i = startIdx; i < parts.length; i++) {
    accumulated += sep + parts[i];
    segments.push({ label: parts[i], path: accumulated });
  }

  return segments;
}

/** Build the browse API URL for an optional path argument. */
function buildBrowseUrl(path?: string): string {
  return path ? `/api/projects/browse?path=${encodeURIComponent(path)}` : '/api/projects/browse';
}

/** Whether a failed browse response should trigger the homedir fallback. */
function shouldFallbackToHome(fallbackOnForbidden: boolean, path: string | undefined, status: number): boolean {
  return fallbackOnForbidden && Boolean(path) && status === 403;
}

/**
 * F113 drive-picker state: tracks whether we're showing the drives grid vs a
 * directory listing, and lazily loads the Windows drive list on first entry.
 * "此电脑" entry is gated by isWindowsServer (the API server's filesystem
 * platform, derived from the browsed path) — NOT the browser client's UA — so
 * a macOS/Linux client browsing a Windows-hosted server still gets drive
 * switching, and a Windows client against a non-Windows server sees no picker.
 */
function useDrivesLoader(isWindowsServer: boolean) {
  const [view, setView] = useState<'directory' | 'drives'>('directory');
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const drivesLoadedRef = useRef(false);

  // Lazily fetch drives only when the user enters the drives view — keeps
  // mount-time API calls unchanged for the common directory-browsing path.
  useEffect(() => {
    if (view !== 'drives') return;
    if (drivesLoadedRef.current) return;
    drivesLoadedRef.current = true;
    (async () => {
      try {
        const res = await apiFetch('/api/projects/drives');
        if (!res.ok) return;
        const data = await res.json();
        setDrives(Array.isArray(data.drives) ? data.drives : []);
      } catch {
        // drives unavailable — non-fatal, drives stays []
      }
    })();
  }, [view]);

  const showDrivesView = useCallback(() => setView('drives'), []);
  const showDirectoryView = useCallback(() => setView('directory'), []);

  return {
    view,
    drives,
    showThisPcEntry: isWindowsServer,
    showDrivesView,
    showDirectoryView,
  };
}

export function DirectoryBrowser({
  initialPath,
  activeProjectPath,
  onCurrentPathChange,
  onCancel,
}: DirectoryBrowserProps) {
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const ime = useIMEGuard();
  const [creatingDir, setCreatingDir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [mkdirError, setMkdirError] = useState<string | null>(null);
  const newDirInputRef = useRef<HTMLInputElement>(null);
  // Gate "此电脑" on the SERVER's filesystem platform (derived from the browsed
  // path), not the browser client's userAgent — a macOS client browsing a
  // Windows-hosted server still needs drive switching (codex review P2).
  const isWindowsServer = browseResult?.current ? /^[A-Za-z]:[\\/]/.test(browseResult.current) : false;
  const { view, drives, showThisPcEntry, showDrivesView, showDirectoryView } = useDrivesLoader(isWindowsServer);

  const fetchDirectory = useCallback(
    async (path?: string, fallbackOnForbidden = false) => {
      setIsLoading(true);
      setError(null);
      showDirectoryView();
      try {
        const res = await apiFetch(buildBrowseUrl(path));
        if (!res.ok) {
          // 403 fallback (initial load only) — otherwise surface the error.
          if (shouldFallbackToHome(fallbackOnForbidden, path, res.status)) {
            setInfo('配置路径不可用，已切换到主目录');
            // await so outer finally doesn't clear isLoading before fallback finishes
            await fetchDirectory(undefined, false);
            return;
          }
          const errData = await res.json();
          setError(errData.error || 'Failed to browse directory');
          // Keep previous browseResult — don't destroy current listing on error.
          return;
        }
        const data: BrowseResult = await res.json();
        setBrowseResult(data);
        setPathInput(data.current);
        onCurrentPathChange?.(data.current);
      } catch {
        setError('Unable to connect to server');
      } finally {
        setIsLoading(false);
      }
    },
    [onCurrentPathChange, showDirectoryView],
  );

  // Initial load — try initialPath, fallback to homedir on 403 (with visible info)
  useEffect(() => {
    fetchDirectory(initialPath, !!initialPath);
  }, [fetchDirectory, initialPath]);

  const handlePathSubmit = useCallback(() => {
    const trimmed = pathInput.trim();
    if (trimmed) fetchDirectory(trimmed);
  }, [pathInput, fetchDirectory]);

  // Enter "此电脑" drive-picker view: clear transient error/info + any
  // in-progress create-folder state, then switch. Without clearing create-folder
  // state, an already-open inline editor survives the transition and
  // handleCreateDir would post parentPath from the stale previous directory
  // (R2 review: wrong-location filesystem mutation).
  const enterDrivesView = useCallback(() => {
    setError(null);
    setInfo(null);
    setCreatingDir(false);
    setNewDirName('');
    setMkdirError(null);
    showDrivesView();
  }, [showDrivesView]);

  const handleStartCreateDir = useCallback(() => {
    setCreatingDir(true);
    setNewDirName('');
    setMkdirError(null);
    setTimeout(() => newDirInputRef.current?.focus(), 0);
  }, []);

  const handleCreateDir = useCallback(async () => {
    if (!newDirName.trim() || !browseResult) return;
    setMkdirError(null);
    try {
      const res = await apiFetch('/api/projects/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: browseResult.current, name: newDirName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMkdirError(data.error || '创建失败');
        return;
      }
      const data = await res.json();
      setCreatingDir(false);
      setNewDirName('');
      fetchDirectory(data.createdPath);
    } catch {
      setMkdirError('无法连接到服务器');
    }
  }, [newDirName, browseResult, fetchDirectory]);

  const segments = browseResult ? pathToSegments(browseResult.current, browseResult.homePath) : [];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* ── Breadcrumb + New Folder ── */}
      <div className="flex items-center gap-1 px-5 h-10 bg-cafe-white console-divider-b flex-shrink-0 overflow-x-auto">
        {showThisPcEntry && (
          <span className="flex items-center gap-1 flex-shrink-0">
            {view === 'drives' ? (
              <span className="text-xs font-semibold text-cafe-black flex items-center gap-1">
                <PcIcon />
                此电脑
              </span>
            ) : (
              <button
                type="button"
                onClick={enterDrivesView}
                className="text-xs font-medium text-cafe-accent hover:underline flex items-center gap-1"
              >
                <PcIcon />
                此电脑
              </button>
            )}
          </span>
        )}
        {segments.map((seg, i) => {
          // VS Code-style breadcrumb: drive root shows "D:" (no trailing
          // separator, no friendly label), subdirectories show their name.
          // seg.label is already "D:" for drive roots (windowsDriveSegments
          // strips the separator) and the dir name otherwise — using it
          // directly avoids depending on the lazily-loaded drives list.
          const isLast = i === segments.length - 1;
          const label = seg.label;
          const showSeparator = showThisPcEntry || i > 0;
          return (
            <span key={seg.path || `_${i}`} className="flex items-center gap-1 flex-shrink-0">
              {showSeparator && (
                <svg aria-hidden="true" className="w-3 h-3 text-cafe-muted" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {isLast ? (
                <span className="text-xs font-semibold text-cafe-black">{label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => fetchDirectory(seg.path || undefined)}
                  className="text-xs font-medium text-cafe-accent hover:underline"
                >
                  {i === 0 && seg.label === 'Home' ? (
                    <span className="flex items-center gap-1">
                      <HomeIcon />
                      {seg.label}
                    </span>
                  ) : (
                    label
                  )}
                </button>
              )}
            </span>
          );
        })}
        {/* [+] New folder button — hidden in drives view (no current dir, codex review P2) */}
        {view !== 'drives' && (
          <button
            type="button"
            onClick={handleStartCreateDir}
            className="ml-auto flex-shrink-0 px-2 py-1 flex items-center gap-1 rounded-md border border-cafe-accent/30 bg-cafe-surface/50 text-cafe-accent hover:bg-cafe-surface hover:border-cafe-accent/50 transition-colors text-xs font-medium"
            title="新建文件夹"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
            </svg>
            新建
          </button>
        )}
      </div>

      {/* ── Directory listing ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 min-h-0">
        {/* Inline new folder input */}
        {creatingDir && (
          <div className="px-3 py-2 rounded-lg ring-2 ring-cafe-accent bg-cafe-surface/50 mb-1">
            <div className="flex items-center gap-2">
              <FolderIcon className="text-cafe-accent" />
              <input
                ref={newDirInputRef}
                type="text"
                value={newDirName}
                onChange={(e) => setNewDirName(e.target.value)}
                onCompositionStart={ime.onCompositionStart}
                onCompositionEnd={ime.onCompositionEnd}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ime.isComposing()) {
                    e.preventDefault();
                    return;
                  }
                  if (e.key === 'Enter') handleCreateDir();
                  if (e.key === 'Escape') {
                    setCreatingDir(false);
                    setMkdirError(null);
                  }
                }}
                placeholder="文件夹名称..."
                className="flex-1 text-sm px-2 py-1 rounded border border-cafe-accent/30 bg-cafe-surface-canvas focus:outline-none focus:ring-1 focus:ring-cafe-accent"
              />
              <button
                type="button"
                onClick={handleCreateDir}
                disabled={!newDirName.trim()}
                className="text-xs px-2.5 py-1 rounded bg-cafe-accent text-[var(--cafe-surface)] hover:bg-cafe-interactive disabled:opacity-40 transition-colors"
              >
                创建
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatingDir(false);
                  setMkdirError(null);
                }}
                className="text-xs text-cafe-muted hover:text-cafe-secondary"
              >
                取消
              </button>
            </div>
            {mkdirError && <p className="text-micro text-conn-red-text mt-1 ml-6">{mkdirError}</p>}
          </div>
        )}

        {/* ── Drives view (Windows only): grid of drive letters ── */}
        {view === 'drives' && (
          <div className="py-2">
            {drives.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <span className="text-xs text-cafe-muted">未发现可用磁盘</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 px-2">
                {drives.map((drive) => {
                  const isActive = activeProjectPath?.toLowerCase() === drive.path.toLowerCase();
                  return (
                    <button
                      key={drive.letter}
                      type="button"
                      onClick={() => fetchDirectory(drive.path)}
                      className={`text-left px-3 py-2.5 text-sm rounded-lg transition-colors flex items-center gap-2.5 ${
                        isActive ? 'bg-cafe-surface ring-1 ring-cafe-accent/40' : 'hover:bg-cafe-surface/50'
                      }`}
                      title={drive.path}
                    >
                      <DriveIcon className="text-cafe-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-cafe-black truncate">{drive.label}</div>
                        <div className="text-micro text-cafe-muted truncate">{drive.path}</div>
                      </div>
                      {isActive && <span className="text-micro text-cafe-accent flex-shrink-0">当前项目</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {view === 'directory' && isLoading && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-cafe-muted animate-pulse">Loading...</span>
          </div>
        )}

        {info && (
          <div className="px-3 py-1.5 mb-1">
            <p className="text-micro text-cafe-accent">{info}</p>
          </div>
        )}

        {error && (
          <div className="px-3 py-1.5 mb-1">
            <p className="text-xs text-conn-red-text">{error}</p>
          </div>
        )}

        {view === 'directory' && !isLoading && browseResult && browseResult.entries.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-cafe-muted">No subdirectories</span>
          </div>
        )}

        {view === 'directory' &&
          !isLoading &&
          browseResult?.entries.map((entry) => {
            const isActive = activeProjectPath === entry.path;
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => fetchDirectory(entry.path)}
                className={`w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors flex items-center gap-2.5 ${
                  isActive ? 'bg-cafe-surface' : 'hover:bg-cafe-surface/50'
                }`}
                title={entry.path}
              >
                <FolderIcon className={isActive ? 'text-cafe-accent' : 'text-cafe-muted'} />
                <span className="font-medium text-cafe-black truncate flex-1">{entry.name}</span>
                {isActive && <span className="text-micro text-cafe-accent flex-shrink-0">当前项目</span>}
                <svg
                  aria-hidden="true"
                  className="w-3.5 h-3.5 text-cafe-muted flex-shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            );
          })}
      </div>

      {/* ── Path input ── */}
      <div className="px-5 py-3 console-divider-t space-y-2 flex-shrink-0">
        <div className="flex gap-2">
          <TerminalIcon />
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !ime.isComposing()) handlePathSubmit();
            }}
            placeholder="Enter path..."
            className="flex-1 text-xs px-3 py-2 rounded-lg border border-[var(--console-border-soft)] bg-cafe-white focus:outline-none focus:ring-1 focus:ring-cafe-accent"
          />
          {pathInput.trim() && (
            <button
              type="button"
              onClick={handlePathSubmit}
              className="px-2.5 py-2 rounded-lg border border-[var(--console-border-soft)] bg-cafe-white text-cafe-secondary hover:bg-cafe-surface transition-colors"
              aria-label="Go to path"
            >
              <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>

        {/* ── Action bar ── */}
        <div className="flex items-center gap-2 pt-1">
          {view === 'drives' ? (
            <span className="text-xs text-cafe-secondary truncate flex-1">此电脑</span>
          ) : (
            browseResult && (
              <span className="text-xs text-cafe-secondary truncate flex-1" title={browseResult.current}>
                {browseResult.current}
              </span>
            )
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[var(--console-border-soft)] text-cafe-secondary text-xs font-medium transition-colors hover:bg-cafe-surface-elevated"
          >
            收起浏览
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  );
}

function PcIcon() {
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 4.5A1.5 1.5 0 013.5 3h13A1.5 1.5 0 0118 4.5v8a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 012 12.5v-8z" />
      <path d="M4 14h12v1.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 014 15.5V14z" opacity="0.5" />
    </svg>
  );
}

function DriveIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`w-4 h-4 flex-shrink-0 ${className ?? ''}`}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v7A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5v-7zm2.5 6.5a1 1 0 100-2 1 1 0 000 2z" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`w-4 h-4 flex-shrink-0 ${className ?? ''}`}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5 text-cafe-muted mt-2.5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M2 4.25A2.25 2.25 0 014.25 2h11.5A2.25 2.25 0 0118 4.25v11.5A2.25 2.25 0 0115.75 18H4.25A2.25 2.25 0 012 15.75V4.25zM7.664 6.23a.75.75 0 00-1.078 1.04l2.705 2.805-2.705 2.805a.75.75 0 001.078 1.04l3.25-3.37a.75.75 0 000-1.04l-3.25-3.28zM11 13a.75.75 0 000 1.5h3a.75.75 0 000-1.5h-3z"
        clipRule="evenodd"
      />
    </svg>
  );
}
