import React, { useState, useMemo } from 'react';
import type { GitRepositoryInfo, GitBranch, GitStash, GitCommit, GitWorkingTreeStatus } from '../../types/git';
import type { GitRemote } from '../../../../shared/src/git-types';
import {
  FolderGit2,
  FolderSearch,
  Plus,
  RefreshCw,
  Search,
  Clock,
  Cloud,
  Tag,
  ChevronDown,
  ChevronRight,
  Folder,
  Check,
  FileCode2,
} from 'lucide-react';

interface GitRepoSidebarProps {
  repositories: GitRepositoryInfo[];
  selectedRepo: GitRepositoryInfo | null;
  onSelectRepo: (repo: GitRepositoryInfo) => void;
  onScan: (rootPath: string, maxDepth: number) => void;
  isScanning: boolean;
  defaultRootPath?: string;
  onRefreshActive?: () => void;
  isRefreshingActive?: boolean;
  status?: GitWorkingTreeStatus | null;
  workspaceView?: 'status' | 'history' | 'search';
  onWorkspaceView?: (view: 'status' | 'history' | 'search') => void;
  branches?: GitBranch[];
  remotes?: GitRemote[];
  commits?: GitCommit[];
  stashes?: GitStash[];
  onCheckout?: (name: string) => void;
  onCreateBranch?: () => void;
  onFetch?: (remote: string) => void;
  onPopStash?: (index: number) => void;
  onSelectCommit?: (commit: GitCommit) => void;
}

export const GitRepoSidebar: React.FC<GitRepoSidebarProps> = ({
  repositories,
  selectedRepo,
  onSelectRepo,
  onScan,
  isScanning,
  defaultRootPath = '.',
  onRefreshActive,
  isRefreshingActive,
  status,
  workspaceView = 'status',
  onWorkspaceView,
  branches = [],
  remotes = [],
  commits = [],
  stashes = [],
  onCheckout,
  onCreateBranch,
  onFetch,
  onPopStash,
  onSelectCommit,
}) => {
  const [scanPath, setScanPath] = useState(defaultRootPath);
  const [maxDepth, setMaxDepth] = useState(4);
  const [repoFilterQuery, setRepoFilterQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    feature: true,
    bugfix: true,
    release: true,
  });

  const toggleFolder = (folder: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folder]: !prev[folder],
    }));
  };

  const filteredRepos = useMemo(() => {
    const q = repoFilterQuery.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((repo) =>
      `${repo.name} ${repo.path} ${repo.currentBranch}`.toLowerCase().includes(q)
    );
  }, [repositories, repoFilterQuery]);

  const changeCount = status
    ? new Set([...status.staged, ...status.unstaged, ...status.untracked].map((file) => file.path)).size
    : (selectedRepo?.stagedCount ?? 0) +
      (selectedRepo?.unstagedCount ?? 0) +
      (selectedRepo?.untrackedCount ?? 0);

  const tags = useMemo(() => {
    return commits
      .flatMap((commit) =>
        commit.refs
          .filter((ref) => ref.type === 'tag')
          .map((ref) => ({ name: ref.name, commit }))
      )
      .filter((tag, index, all) => all.findIndex((item) => item.name === tag.name) === index);
  }, [commits]);

  // Group local branches into folders and root branches
  const localBranches = useMemo(() => {
    return branches.filter((b) => !b.isRemote);
  }, [branches]);

  const { branchFolders, rootBranches } = useMemo(() => {
    const folders: Record<string, GitBranch[]> = {};
    const roots: GitBranch[] = [];

    const query = filterQuery.trim().toLowerCase();

    localBranches.forEach((b) => {
      if (query && !b.name.toLowerCase().includes(query)) {
        return;
      }

      const slashIndex = b.name.indexOf('/');
      if (slashIndex > 0) {
        const folderName = b.name.slice(0, slashIndex);
        if (!folders[folderName]) folders[folderName] = [];
        folders[folderName].push(b);
      } else {
        roots.push(b);
      }
    });

    return { branchFolders: folders, rootBranches: roots };
  }, [localBranches, filterQuery]);

  const filteredRemotes = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return remotes;
    return remotes.filter((r) => r.name.toLowerCase().includes(query));
  }, [remotes, filterQuery]);

  const filteredTags = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    if (!query) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(query));
  }, [tags, filterQuery]);

  const control =
    'min-h-7 px-2 py-1 rounded text-xs text-app-ink hover:bg-slate-200/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-40 transition-colors';
  const row = `${control} w-full flex items-center gap-2 text-left`;
  const field =
    'w-full min-h-8 rounded border border-app-line bg-white px-2 text-xs text-app-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

  return (
    <aside
      aria-label="Git Repositories Sidebar"
      className="w-full md:w-60 shrink-0 flex flex-col bg-[#f0f3f7] border-r border-app-line md:h-full select-none overflow-hidden"
    >
      {/* Top Header with Local Repositories and switcher */}
      <div className="p-2.5 border-b border-app-line space-y-1.5 bg-[#e8ecf2]">
        <div className="flex items-center justify-between text-xs font-semibold text-app-ink">
          <span className="flex items-center gap-1.5">
            <FolderGit2 aria-hidden="true" className="w-4 h-4 text-brand-600" />
            Local Repositories
          </span>
          <span className="text-[11px] font-normal text-slate-500">{repositories.length} found</span>
        </div>

        <label className="block text-[11px] text-app-muted">
          Repository
          <select
            aria-label="Repository"
            value={filteredRepos.some((r) => r.path === selectedRepo?.path) ? selectedRepo?.path : ''}
            onChange={(e) => {
              const repo = repositories.find((item) => item.path === e.target.value);
              if (repo) onSelectRepo(repo);
            }}
            className={field}
          >
            <option value="" disabled>
              Select repository
            </option>
            {filteredRepos.map((repo) => (
              <option key={repo.path} value={repo.path}>
                {repo.name}
              </option>
            ))}
          </select>
        </label>

        <input
          aria-label="Filter repositories"
          placeholder="Filter repositories…"
          value={repoFilterQuery}
          onChange={(e) => setRepoFilterQuery(e.target.value)}
          className={field}
        />

        {/* Directory Scanner details when no repository selected */}
        {!selectedRepo && (
          <details open={!repositories.length} className="pt-1">
            <summary className={`${control} flex items-center cursor-pointer gap-2`}>
              <FolderSearch aria-hidden="true" className="w-4 h-4" />
              Scan folders
            </summary>
            <form
              className="space-y-2 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (scanPath.trim()) onScan(scanPath.trim(), maxDepth);
              }}
            >
              <label className="block text-xs text-app-muted">
                Folder path
                <input
                  aria-label="Scan directory path"
                  value={scanPath}
                  onChange={(e) => setScanPath(e.target.value)}
                  className={field}
                />
              </label>
              <label className="block text-xs text-app-muted">
                Scan Depth
                <select
                  aria-label="Scan Depth"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  className={field}
                >
                  <option value={2}>Depth 2</option>
                  <option value={4}>Depth 4</option>
                  <option value={6}>Depth 6</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={isScanning || !scanPath.trim()}
                className={`${control} w-full bg-brand-600 text-white hover:bg-brand-700 min-h-8 font-medium`}
              >
                {isScanning ? 'Scanning…' : 'Scan Directory'}
              </button>
            </form>
          </details>
        )}

        {selectedRepo && (
          <div className="flex items-center gap-1 pt-1">
            <span className="truncate text-[11px] text-app-muted flex-1 font-mono" title={selectedRepo.path}>
              {selectedRepo.path}
            </span>
            {onRefreshActive && (
              <button
                type="button"
                aria-label="Refresh Active Repository"
                onClick={onRefreshActive}
                disabled={isRefreshingActive}
                className={control}
                title="Refresh active repository"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`w-3.5 h-3.5 ${isRefreshingActive ? 'motion-safe:animate-spin' : ''}`}
                />
              </button>
            )}
          </div>
        )}
      </div>

      {/* SourceTree Navigation Sections (Workspace, Branches, Tags, Remotes) */}
      {selectedRepo ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <nav aria-label="Repository navigation" className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
            {/* WORKSPACE */}
            <section aria-label="Workspace">
              <h3 className="px-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1">
                WORKSPACE
              </h3>
              <div className="space-y-0.5">
                {/* File Status */}
                <button
                  type="button"
                  aria-current={workspaceView === 'status' ? 'page' : undefined}
                  onClick={() => onWorkspaceView?.('status')}
                  className={`${row} px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    workspaceView === 'status'
                      ? 'bg-blue-100/80 text-blue-900 font-semibold shadow-xs'
                      : 'text-slate-700 hover:bg-slate-200/60'
                  }`}
                >
                  <FileCode2 className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="flex-1">File Status</span>
                  {changeCount > 0 && (
                    <span className="min-w-4 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                      {changeCount}
                    </span>
                  )}
                </button>

                {/* History */}
                <button
                  type="button"
                  aria-current={workspaceView === 'history' ? 'page' : undefined}
                  onClick={() => onWorkspaceView?.('history')}
                  className={`${row} px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    workspaceView === 'history'
                      ? 'bg-blue-100/80 text-blue-900 font-semibold shadow-xs'
                      : 'text-slate-700 hover:bg-slate-200/60'
                  }`}
                >
                  <Clock className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="flex-1">History</span>
                </button>

                {/* Search */}
                <button
                  type="button"
                  aria-current={workspaceView === 'search' ? 'page' : undefined}
                  onClick={() => onWorkspaceView?.('search')}
                  className={`${row} px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    workspaceView === 'search'
                      ? 'bg-blue-100/80 text-blue-900 font-semibold shadow-xs'
                      : 'text-slate-700 hover:bg-slate-200/60'
                  }`}
                >
                  <Search className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="flex-1">Search</span>
                </button>
              </div>
            </section>

            {/* BRANCHES */}
            <section aria-label="Branches">
              <div className="flex items-center justify-between px-2 mb-1">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                  BRANCHES
                </h3>
                {onCreateBranch && (
                  <button
                    type="button"
                    aria-label="Create branch"
                    disabled={isRefreshingActive}
                    onClick={onCreateBranch}
                    className="p-0.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
                    title="Create new branch"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="space-y-0.5">
                {/* Root Branches */}
                {rootBranches.map((branch) => {
                  const isCurrent = branch.current;
                  return (
                    <button
                      type="button"
                      key={branch.name}
                      disabled={isRefreshingActive}
                      onClick={() => onCheckout?.(branch.name)}
                      className={`${row} px-2 py-1 text-xs rounded transition-colors group ${
                        isCurrent ? 'font-bold text-slate-900' : 'text-slate-700 hover:bg-slate-200/60'
                      }`}
                      title={isCurrent ? `Current branch: ${branch.name}` : `Checkout ${branch.name}`}
                    >
                      {/* SourceTree Active Blue Dot */}
                      {isCurrent ? (
                        <span
                          aria-label="Current branch"
                          className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0 shadow-xs"
                          title="Current branch"
                        />
                      ) : (
                        <span className="w-2.5 h-2.5 shrink-0" />
                      )}
                      <span className="truncate flex-1 font-mono text-[11px]">{branch.name}</span>
                      {isCurrent && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                    </button>
                  );
                })}

                {/* Folder Grouped Branches (e.g. feature/...) */}
                {Object.entries(branchFolders).map(([folderName, folderBranches]) => {
                  const isExpanded = expandedFolders[folderName] ?? true;
                  return (
                    <div key={`folder-${folderName}`} className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => toggleFolder(folderName)}
                        className={`${row} px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200/60`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        )}
                        <Folder className="w-3.5 h-3.5 text-amber-500 fill-amber-500/20 shrink-0" />
                        <span className="truncate flex-1 font-medium">{folderName}</span>
                      </button>

                      {isExpanded && (
                        <div className="pl-6 space-y-0.5">
                          {folderBranches.map((branch) => {
                            const isCurrent = branch.current;
                            const subName = branch.name.slice(folderName.length + 1);
                            return (
                              <button
                                type="button"
                                key={branch.name}
                                disabled={isRefreshingActive}
                                onClick={() => onCheckout?.(branch.name)}
                                className={`${row} px-2 py-1 text-xs rounded transition-colors group ${
                                  isCurrent ? 'font-bold text-slate-900' : 'text-slate-700 hover:bg-slate-200/60'
                                }`}
                                title={
                                  isCurrent
                                    ? `Current branch: ${branch.name}`
                                    : `Checkout ${branch.name}`
                                }
                              >
                                {isCurrent ? (
                                  <span
                                    aria-label="Current branch"
                                    className="w-2 h-2 rounded-full bg-blue-600 shrink-0 shadow-xs"
                                  />
                                ) : (
                                  <span className="w-2 h-2 shrink-0" />
                                )}
                                <span className="truncate flex-1 font-mono text-[11px]">{subName}</span>
                                {isCurrent && <Check className="w-3 h-3 text-blue-600 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {localBranches.length === 0 && (
                  <p className="px-2 py-1 text-xs text-app-muted italic">No local branches</p>
                )}
              </div>
            </section>

            {/* TAGS */}
            <section aria-label="Tags">
              <h3 className="px-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1">
                TAGS
              </h3>
              <div className="space-y-0.5">
                {filteredTags.map((tag) => (
                  <button
                    type="button"
                    key={tag.name}
                    onClick={() => onSelectCommit?.(tag.commit)}
                    className={`${row} px-2 py-1 text-xs font-mono text-[11px]`}
                  >
                    <Tag className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{tag.name}</span>
                  </button>
                ))}
                {!filteredTags.length && (
                  <p className="px-2 py-1 text-xs text-app-muted italic">No tags in history</p>
                )}
              </div>
            </section>

            {/* REMOTES */}
            <section aria-label="Remotes">
              <h3 className="px-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1">
                REMOTES
              </h3>
              <div className="space-y-1">
                {filteredRemotes.map((remote) => (
                  <details key={remote.name} open className="group/remote">
                    <summary className={`${control} cursor-pointer flex items-center justify-between`}>
                      <span className="inline-flex gap-1.5 items-center font-medium">
                        <Cloud className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span>{remote.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFetch?.(remote.name);
                        }}
                        disabled={isRefreshingActive}
                        className="p-1 rounded text-slate-400 hover:text-slate-700"
                        title={`Fetch ${remote.name}`}
                        aria-label={`Fetch ${remote.name}`}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </summary>

                    {/* Remote Branches */}
                    <div className="pl-5 space-y-0.5 mt-0.5">
                      {branches
                        .filter(
                          (branch) =>
                            branch.isRemote && branch.name.startsWith(`${remote.name}/`)
                        )
                        .map((branch) => {
                          const simpleName = branch.name.replace(`${remote.name}/`, '');
                          return (
                            <div
                              key={branch.name}
                              title={branch.name}
                              className="px-2 py-1 text-xs font-mono text-[11px] text-slate-600 truncate rounded hover:bg-slate-200/50"
                            >
                              {simpleName}
                            </div>
                          );
                        })}
                    </div>
                  </details>
                ))}
                {!filteredRemotes.length && (
                  <p className="px-2 py-1 text-xs text-app-muted italic">No remotes configured</p>
                )}
              </div>
            </section>

            {/* STASHES */}
            {stashes.length > 0 && (
              <section aria-label="Stashes">
                <h3 className="px-2 text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-1">
                  STASHES
                </h3>
                <div className="space-y-1">
                  {stashes.map((stash) => (
                    <div
                      key={stash.index}
                      className="p-1.5 rounded bg-slate-100/70 border border-slate-200/60 text-xs"
                    >
                      <p className="truncate text-app-ink font-mono text-[10px]" title={stash.message}>
                        stash@{`{${stash.index}}`} {stash.message}
                      </p>
                      <button
                        type="button"
                        disabled={isRefreshingActive}
                        onClick={() => onPopStash?.(stash.index)}
                        className={`${control} mt-1 text-[11px] w-full text-center bg-white border border-slate-200`}
                        aria-label={`Pop / Apply stash ${stash.index}`}
                      >
                        Pop / Apply
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </nav>

          {/* Bottom Filter Bar */}
          <div className="shrink-0 p-2 border-t border-app-line bg-[#e8ecf2]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                aria-label="Filter sidebar items"
                placeholder="Filter"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full pl-8 pr-2 py-1 text-xs rounded border border-slate-300 bg-white text-app-ink placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 shadow-xs"
              />
            </div>
          </div>
        </div>
      ) : (
        <p className="p-4 text-xs text-app-muted">Scan a folder to discover Git repositories.</p>
      )}
    </aside>
  );
};
