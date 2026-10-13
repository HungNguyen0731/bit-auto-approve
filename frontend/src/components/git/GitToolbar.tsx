import React from 'react';
import type { GitRepositoryInfo, GitWorkingTreeStatus } from '../../types/git';
import {
  CircleArrowDown,
  CircleArrowUp,
  ArrowDown,
  GitBranch,
  GitMerge,
  Archive,
  Globe,
  Terminal,
  Settings,
  Search,
} from 'lucide-react';

interface GitToolbarProps {
  selectedRepo: GitRepositoryInfo | null;
  status: GitWorkingTreeStatus | null;
  onOpenBranchModal: () => void;
  onOpenStashModal: () => void;
  onOpenRemoteModal: (type: 'fetch' | 'pull' | 'push') => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onCommit?: () => void;
  onOpenMergeModal?: () => void;
  onViewRemote?: () => void;
  onOpenFinder?: () => void;
  onOpenTerminal?: () => void;
  onOpenSettings?: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
}

export const GitToolbar: React.FC<GitToolbarProps> = (props) => {
  const { selectedRepo, status, isRefreshing } = props;

  const behindCount = status?.behind ?? selectedRepo?.behind ?? 0;
  const aheadCount = status?.ahead ?? selectedRepo?.ahead ?? 0;

  const leftActions = [
    {
      label: 'Commit',
      icon: (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="w-6 h-6 text-blue-600 fill-none stroke-current stroke-[1.75]"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v10M7 12h10" />
        </svg>
      ),
      count: status?.staged.length ?? selectedRepo?.stagedCount ?? 0,
      badgeColor: 'bg-blue-600 text-white',
      onClick: props.onCommit,
      title: 'Review staged files and commit',
    },
    {
      label: 'Pull',
      icon: <CircleArrowDown aria-hidden="true" className="w-6 h-6 text-slate-700 stroke-[1.5]" />,
      count: behindCount,
      badgeColor: 'bg-rose-600 text-white',
      onClick: () => props.onOpenRemoteModal('pull'),
      title: 'Pull and merge latest remote commits',
    },
    {
      label: 'Push',
      icon: <CircleArrowUp aria-hidden="true" className="w-6 h-6 text-slate-700 stroke-[1.5]" />,
      count: aheadCount,
      badgeColor: 'bg-blue-600 text-white',
      onClick: () => props.onOpenRemoteModal('push'),
      title: 'Push local commits to remote',
    },
    {
      label: 'Fetch',
      icon: (
        <span className="relative flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-slate-600">
          <ArrowDown aria-hidden="true" className="w-3.5 h-3.5 text-slate-700 stroke-[2]" />
        </span>
      ),
      onClick: () => props.onOpenRemoteModal('fetch'),
      title: 'Fetch latest remote commits without merging',
    },
    {
      label: 'Branch',
      icon: <GitBranch aria-hidden="true" className="w-6 h-6 text-slate-700 stroke-[1.5]" />,
      onClick: props.onOpenBranchModal,
      title: 'Branch management',
    },
    {
      label: 'Merge',
      icon: <GitMerge aria-hidden="true" className="w-6 h-6 text-slate-700 stroke-[1.5]" />,
      onClick: props.onOpenMergeModal,
      title: 'Merge another branch into the current branch',
    },
    {
      label: 'Stash',
      icon: <Archive aria-hidden="true" className="w-6 h-6 text-slate-700 stroke-[1.5]" />,
      onClick: props.onOpenStashModal,
      title: 'Stash management',
    },
  ];

  const buttonClass =
    'relative min-w-14 px-2 py-1.5 flex flex-col items-center justify-center gap-1 rounded-lg text-[11px] text-slate-700 hover:text-slate-900 hover:bg-slate-200/60 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 transition-colors select-none';

  return (
    <div
      role="group"
      aria-label="Git Action Toolbar"
      className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-1.5 bg-[#e8ecf2] border-b border-app-line select-none shadow-xs"
    >
      {/* Left Operations Group */}
      <div role="group" aria-label="Repository actions" className="flex items-center gap-1">
        {leftActions.map(({ label, icon, count, badgeColor, onClick, title }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={title}
            disabled={!selectedRepo || isRefreshing}
            onClick={onClick}
            className={buttonClass}
          >
            <span className="relative flex items-center justify-center">
              {icon}
              {count !== undefined && count > 0 && (
                <span
                  className={`absolute -right-2.5 -top-1.5 min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-[10px] font-bold shadow-xs leading-none ${badgeColor}`}
                  title={`${count} ${
                    label === 'Commit'
                      ? 'pending changes'
                      : label === 'Pull'
                      ? 'commits behind'
                      : 'commits ahead'
                  }`}
                >
                  {count}
                </span>
              )}
            </span>
            <span className="leading-tight text-[11px] font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* Right Utilities & Search Group */}
      <div role="group" aria-label="Open repository" className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {/* View Remote */}
          <button
            type="button"
            aria-label="View Remote"
            onClick={props.onViewRemote}
            disabled={!selectedRepo || isRefreshing}
            className={buttonClass}
            title="Open repository in web browser"
          >
            <Globe aria-hidden="true" className="w-5 h-5 text-slate-700 stroke-[1.5]" />
            <span className="leading-tight text-[11px] font-medium">View Remote</span>
          </button>

          {/* Show in Finder */}
          <button
            type="button"
            aria-label="Show in Finder"
            onClick={props.onOpenFinder}
            disabled={!selectedRepo || isRefreshing}
            className={buttonClass}
            title="Reveal repository folder in macOS Finder"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="w-5 h-5 text-slate-700 stroke-current stroke-[1.5] fill-none"
            >
              <rect x="2" y="2" width="20" height="20" rx="4" />
              <path d="M12 2v10M9 8h6M7 16c2.5 2.5 7.5 2.5 10 0" />
            </svg>
            <span className="leading-tight text-[11px] font-medium">Show in Finder</span>
          </button>

          {/* Terminal */}
          <button
            type="button"
            aria-label="Terminal"
            onClick={props.onOpenTerminal}
            disabled={!selectedRepo || isRefreshing}
            className={buttonClass}
            title="Open macOS Terminal in repository path"
          >
            <Terminal aria-hidden="true" className="w-5 h-5 text-slate-700 stroke-[1.5]" />
            <span className="leading-tight text-[11px] font-medium">Terminal</span>
          </button>

          {/* Settings */}
          <button
            type="button"
            aria-label="Settings"
            onClick={props.onOpenSettings}
            disabled={!selectedRepo || isRefreshing}
            className={buttonClass}
            title="Repository Settings"
          >
            <Settings aria-hidden="true" className="w-5 h-5 text-slate-700 stroke-[1.5]" />
            <span className="leading-tight text-[11px] font-medium">Settings</span>
          </button>
        </div>

        {/* Quick Search */}
        <div className="relative min-w-[140px] max-w-[180px] hidden sm:block">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            aria-label="Search"
            placeholder="Search"
            value={props.searchQuery || ''}
            onChange={(e) => props.onSearchChange?.(e.target.value)}
            disabled={!selectedRepo}
            className="w-full pl-8 pr-2 py-1 text-xs rounded-md border border-slate-300 bg-white/90 text-app-ink placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40 shadow-xs"
          />
        </div>
      </div>
    </div>
  );
};
