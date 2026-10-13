import React, { useState } from 'react';
import type { GitRepositoryInfo } from '../../types/git';
import {
  FolderGit2,
  FolderSearch,
  Search,
  RefreshCw,
  GitBranch,
  ArrowRight,
  FolderOpen,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  Plus,
} from 'lucide-react';

interface GitRepoBrowserProps {
  repositories: GitRepositoryInfo[];
  onSelectRepo: (repo: GitRepositoryInfo) => void;
  onScan: (rootPath: string, maxDepth: number) => void;
  isScanning: boolean;
  defaultRootPath?: string;
  onOpenFinder?: (path: string) => void;
  onOpenTerminal?: (path: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const GitRepoBrowser: React.FC<GitRepoBrowserProps> = ({
  repositories,
  onSelectRepo,
  onScan,
  isScanning,
  defaultRootPath = '.',
  onOpenFinder,
  onOpenTerminal,
  onRefresh,
  isRefreshing = false,
}) => {
  const [scanPath, setScanPath] = useState(defaultRootPath);
  const [maxDepth, setMaxDepth] = useState(4);
  const [filterQuery, setFilterQuery] = useState('');
  const [isScanDrawerOpen, setIsScanDrawerOpen] = useState(repositories.length === 0);

  const filteredRepos = repositories.filter((repo) =>
    `${repo.name} ${repo.path} ${repo.currentBranch}`
      .toLowerCase()
      .includes(filterQuery.trim().toLowerCase())
  );

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scanPath.trim()) {
      onScan(scanPath.trim(), maxDepth);
    }
  };

  return (
    <div
      role="region"
      aria-label="Repositories Browser"
      className="flex-1 flex flex-col bg-white overflow-hidden"
    >
      {/* Top Header */}
      <div className="shrink-0 px-6 py-4 bg-app-panel border-b border-app-line flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600 shadow-xs">
            <FolderGit2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-app-ink">Repositories</h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-100 text-brand-700">
                {repositories.length} found
              </span>
            </div>
            <p className="text-xs text-app-muted">
              Choose a local repository to open workspace or scan directories
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Filter */}
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
            <input
              type="text"
              aria-label="Filter repositories"
              placeholder="Filter repositories…"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-app-line bg-white text-app-ink placeholder:text-app-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 shadow-xs"
            />
          </div>

          {/* Toggle Scan Form */}
          <button
            type="button"
            onClick={() => setIsScanDrawerOpen((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors shadow-xs ${
              isScanDrawerOpen
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-app-ink border-app-line hover:bg-brand-50'
            }`}
          >
            <FolderSearch className="w-4 h-4" />
            <span>Scan Folders</span>
          </button>

          {/* Refresh button */}
          {onRefresh && (
            <button
              type="button"
              aria-label="Refresh repositories"
              onClick={onRefresh}
              disabled={isRefreshing || isScanning}
              className="p-1.5 rounded-lg border border-app-line bg-white text-app-muted hover:text-app-ink hover:bg-brand-50 disabled:opacity-40 transition-colors shadow-xs"
              title="Refresh repository list"
            >
              <RefreshCw
                className={`w-4 h-4 ${isRefreshing || isScanning ? 'animate-spin' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Scan Directory Form */}
      {isScanDrawerOpen && (
        <div className="shrink-0 px-6 py-3 bg-brand-50/60 border-b border-brand-100 animate-slide-up">
          <form
            onSubmit={handleScanSubmit}
            className="flex flex-wrap items-center gap-3"
          >
            <div className="flex-1 min-w-[260px]">
              <label className="block text-[11px] font-semibold text-app-muted mb-1">
                Scan Directory Path
              </label>
              <input
                aria-label="Scan directory path"
                type="text"
                value={scanPath}
                onChange={(e) => setScanPath(e.target.value)}
                placeholder="/path/to/projects or ."
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-app-line bg-white text-app-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 font-mono shadow-xs"
              />
            </div>

            <div className="w-32">
              <label className="block text-[11px] font-semibold text-app-muted mb-1">
                Scan Depth
              </label>
              <select
                aria-label="Scan Depth"
                value={maxDepth}
                onChange={(e) => setMaxDepth(Number(e.target.value))}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-app-line bg-white text-app-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 shadow-xs"
              >
                <option value={2}>Depth 2</option>
                <option value={4}>Depth 4</option>
                <option value={6}>Depth 6</option>
                <option value={8}>Depth 8</option>
              </select>
            </div>

            <div className="self-end">
              <button
                type="submit"
                disabled={isScanning || !scanPath.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition-colors shadow-xs"
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Scanning…</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Scan Directory</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Repository Cards List */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredRepos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-app-muted">
            <div className="w-16 h-16 rounded-2xl bg-app-panel border border-app-line flex items-center justify-center text-app-muted mb-4 shadow-sm">
              <FolderGit2 className="w-8 h-8 opacity-60" />
            </div>
            <h3 className="text-sm font-bold text-app-ink mb-1">
              {repositories.length === 0
                ? 'No Repositories Discovered'
                : `No repositories match "${filterQuery}"`}
            </h3>
            <p className="text-xs text-app-muted max-w-sm mb-4 leading-relaxed">
              {repositories.length === 0
                ? 'Use the directory scanner above to scan local folders and discover your Git projects.'
                : 'Try adjusting your search query or clear the filter to see all repositories.'}
            </p>
            {repositories.length === 0 && (
              <button
                type="button"
                onClick={() => setIsScanDrawerOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 shadow-xs"
              >
                <FolderSearch className="w-4 h-4" />
                <span>Configure Scan</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredRepos.map((repo) => {
              const totalChanges =
                repo.stagedCount + repo.unstagedCount + repo.untrackedCount;

              return (
                <div
                  key={repo.path}
                  onClick={() => onSelectRepo(repo)}
                  className="group relative flex flex-col p-4 rounded-xl border border-app-line bg-white hover:border-brand-400 hover:shadow-soft transition-all cursor-pointer select-none"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600 shrink-0 group-hover:bg-brand-100 transition-colors">
                        <FolderGit2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4
                          className="text-sm font-bold text-app-ink truncate group-hover:text-brand-600 transition-colors"
                          title={repo.name}
                        >
                          {repo.name}
                        </h4>
                        <p
                          className="text-[11px] text-app-muted font-mono truncate max-w-[220px]"
                          title={repo.path}
                        >
                          {repo.path}
                        </p>
                      </div>
                    </div>

                    {/* Branch Badge */}
                    <div className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                      <GitBranch className="w-3 h-3 text-brand-600" />
                      <span className="truncate max-w-[100px]" title={repo.currentBranch}>
                        {repo.currentBranch}
                      </span>
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[11px]">
                    {repo.isClean ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Clean</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium bg-amber-50 text-amber-800 border border-amber-200">
                        <AlertCircle className="w-3 h-3 text-amber-600" />
                        <span>{totalChanges} uncommitted changes</span>
                      </span>
                    )}

                    {repo.ahead > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        ↑ {repo.ahead} ahead
                      </span>
                    )}

                    {repo.behind > 0 && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-medium bg-rose-50 text-rose-700 border border-rose-200">
                        ↓ {repo.behind} behind
                      </span>
                    )}
                  </div>

                  {/* Last Commit Snippet */}
                  {repo.lastCommitMessage ? (
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-app-muted space-y-1 mb-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-brand-600 font-semibold">
                          {repo.lastCommitHash?.slice(0, 7) || 'HEAD'}
                        </span>
                        {repo.lastCommitDate && (
                          <span className="text-[10px] text-app-muted/80 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {new Date(repo.lastCommitDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <p
                        className="text-app-ink line-clamp-1 font-medium"
                        title={repo.lastCommitMessage}
                      >
                        {repo.lastCommitMessage}
                      </p>
                      {repo.lastCommitAuthor && (
                        <div className="flex items-center gap-1 text-[10px] text-app-muted">
                          <User className="w-2.5 h-2.5" />
                          <span>{repo.lastCommitAuthor}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mb-3 text-[11px] text-app-muted italic">
                      No commit history recorded.
                    </div>
                  )}

                  {/* Card Actions */}
                  <div className="mt-auto pt-2 border-t border-app-line/60 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectRepo(repo);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-brand-600 text-white group-hover:bg-brand-700 transition-colors shadow-xs"
                    >
                      <span>Open Workspace</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex items-center gap-1">
                      {onOpenFinder && (
                        <button
                          type="button"
                          aria-label={`Show ${repo.name} in Finder`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFinder(repo.path);
                          }}
                          className="p-1 rounded text-app-muted hover:text-app-ink hover:bg-slate-100 transition-colors"
                          title="Show in Finder"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </button>
                      )}

                      {onOpenTerminal && (
                        <button
                          type="button"
                          aria-label={`Open Terminal in ${repo.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenTerminal(repo.path);
                          }}
                          className="p-1 rounded text-app-muted hover:text-app-ink hover:bg-slate-100 transition-colors"
                          title="Open in Terminal"
                        >
                          <Terminal className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
