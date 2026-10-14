import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { GitRemote } from '../../../../shared/src/git-types';
import type {
  GitBranch,
  GitCommit,
  GitDiffResponse,
  GitFileStatusType,
  GitRepositoryInfo,
  GitStash,
  GitWorkingTreeStatus,
} from '../../types/git';
import { gitApi } from '../../api/gitClient';
import { GitRepoSidebar } from './GitRepoSidebar';
import { GitCommitGraph } from './GitCommitGraph';
import { GitSourceTreeFileStatus } from './GitSourceTreeFileStatus';
import { GitRepoBrowser } from './GitRepoBrowser';
import { GitToolbar } from './GitToolbar';
import { BranchModal, StashModal, RemoteOpsModal, MergeModal, CreatePRModal } from './GitModals';
import { ArrowLeft, FolderGit2, Plus, X } from 'lucide-react';

interface GitManagerProps {
  onShowToast?: (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => void;
  initialRootPath?: string;
  initialView?: 'browser' | 'workspace';
}

const STORAGE_REPOS_KEY = 'bitbucket_pr_approver_git_repos';
const STORAGE_SELECTED_REPO_KEY = 'bitbucket_pr_approver_git_selected_repo';
const STORAGE_OPEN_TABS_KEY = 'bitbucket_pr_approver_git_open_tabs';

export const GitManager: React.FC<GitManagerProps> = ({
  onShowToast,
  initialRootPath = '.',
  initialView = 'browser',
}) => {
  // Navigation & Tabs state with LocalStorage persistence
  const [openTabs, setOpenTabs] = useState<GitRepositoryInfo[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_OPEN_TABS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Repositories state with LocalStorage persistence
  const [repositories, setRepositories] = useState<GitRepositoryInfo[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_REPOS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [selectedRepo, setSelectedRepo] = useState<GitRepositoryInfo | null>(() => {
    try {
      const savedPath = localStorage.getItem(STORAGE_SELECTED_REPO_KEY);
      if (savedPath && initialView === 'workspace') {
        const savedRepos = localStorage.getItem(STORAGE_REPOS_KEY);
        const list: GitRepositoryInfo[] = savedRepos ? JSON.parse(savedRepos) : [];
        return list.find((r) => r.path === savedPath) || null;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [viewMode, setViewMode] = useState<'browser' | 'workspace'>(() => {
    try {
      const savedPath = localStorage.getItem(STORAGE_SELECTED_REPO_KEY);
      if (initialView === 'workspace' && savedPath) {
        return 'workspace';
      }
      return initialView;
    } catch {
      return initialView;
    }
  });

  const [isScanning, setIsScanning] = useState<boolean>(false);

  // In-memory cache for fast tab/repo switching without blanking out
  const repoCache = useRef<
    Map<
      string,
      {
        status: GitWorkingTreeStatus;
        commits: GitCommit[];
        branches: GitBranch[];
        stashes: GitStash[];
        remotes: GitRemote[];
      }
    >
  >(new Map());

  // Save repositories & openTabs & selectedRepo to localStorage
  useEffect(() => {
    try {
      if (repositories.length > 0) {
        localStorage.setItem(STORAGE_REPOS_KEY, JSON.stringify(repositories));
      }
    } catch (e) {
      console.warn('Failed to save repositories to localStorage', e);
    }
  }, [repositories]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_OPEN_TABS_KEY, JSON.stringify(openTabs));
    } catch (e) {
      console.warn('Failed to save openTabs to localStorage', e);
    }
  }, [openTabs]);

  useEffect(() => {
    try {
      if (selectedRepo) {
        localStorage.setItem(STORAGE_SELECTED_REPO_KEY, selectedRepo.path);
      } else {
        localStorage.removeItem(STORAGE_SELECTED_REPO_KEY);
      }
    } catch (e) {
      console.warn('Failed to save selectedRepo to localStorage', e);
    }
  }, [selectedRepo]);

  // Active repo state
  const [status, setStatus] = useState<GitWorkingTreeStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [workspaceView, setWorkspaceView] = useState<'status' | 'history' | 'search'>('status');
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isCreatePRModalOpen, setIsCreatePRModalOpen] = useState(false);
  const [repoWebUrl, setRepoWebUrl] = useState('');
  const [toolbarSearch, setToolbarSearch] = useState('');

  const activePath = useRef<string | null>(null);
  activePath.current = selectedRepo?.path ?? null;
  const diffRequest = useRef(0);

  // Selection state
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [isWorkingTreeSelected, setIsWorkingTreeSelected] = useState<boolean>(true);
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    staged: boolean;
    status: GitFileStatusType;
  } | null>(null);

  // Diff state
  const [diffData, setDiffData] = useState<GitDiffResponse | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState<boolean>(false);

  // Operations state
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isStaging, setIsStaging] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);

  // Modals state
  const [isBranchModalOpen, setIsBranchModalOpen] = useState<boolean>(false);
  const [isStashModalOpen, setIsStashModalOpen] = useState<boolean>(false);
  const [remoteModalType, setRemoteModalType] = useState<'fetch' | 'pull' | 'push' | null>(null);

  const toast = useCallback(
    (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => {
      if (onShowToast) {
        onShowToast(type, title, message);
      }
    },
    [onShowToast]
  );

  // Scan repositories
  const handleScan = useCallback(
    async (rootPath: string, maxDepth: number = 4) => {
      setIsScanning(true);
      try {
        const response = await gitApi.scanRepositories(rootPath, maxDepth);
        setRepositories(response.repositories);
        toast('success', 'Scan Completed', `Discovered ${response.repositories.length} Git repositories.`);
      } catch (err: any) {
        toast('error', 'Scan Failed', err.message || 'Could not scan repositories.');
      } finally {
        setIsScanning(false);
      }
    },
    [toast]
  );

  // Load active repository data
  const loadRepoData = useCallback(
    async (repoPath: string) => {
      setIsRefreshing(true);
      try {
        const [statusRes, commitsRes, branchesRes, stashesRes, remotesRes] = await Promise.all([
          gitApi.getStatus(repoPath),
          gitApi.getCommits(repoPath, { limit: 100 }),
          gitApi.getBranches(repoPath),
          gitApi.getStashes(repoPath),
          gitApi.getRemotes(repoPath),
        ]);
        if (activePath.current !== repoPath) return;

        // Cache the latest snapshot
        repoCache.current.set(repoPath, {
          status: statusRes,
          commits: commitsRes,
          branches: branchesRes,
          stashes: stashesRes,
          remotes: remotesRes,
        });

        setRemotes(remotesRes);
        setStatus(statusRes);
        setCommits(commitsRes);
        setBranches(branchesRes);
        setStashes(stashesRes);

        // Update selectedRepo metadata in list and tabs
        const updateRepoInfo = (r: GitRepositoryInfo) =>
          r.path === repoPath
            ? {
                ...r,
                currentBranch: statusRes.branch,
                isClean: statusRes.isClean,
                stagedCount: statusRes.staged.length,
                unstagedCount: statusRes.unstaged.length,
                untrackedCount: statusRes.untracked.length,
                ahead: statusRes.ahead,
                behind: statusRes.behind,
              }
            : r;

        setRepositories((prev) => prev.map(updateRepoInfo));
        setOpenTabs((prev) => prev.map(updateRepoInfo));
      } catch (err: any) {
        toast('error', 'Failed to load repository data', err.message);
      } finally {
        if (activePath.current === repoPath) setIsRefreshing(false);
      }
    },
    [toast]
  );

  // Trigger scan on mount only if no repositories previously persisted
  useEffect(() => {
    if (repositories.length === 0) {
      handleScan(initialRootPath, 4);
    }
  }, [initialRootPath, handleScan, repositories.length]);

  // When selecting a repo to open from Repository Browser
  const handleSelectRepo = (repo: GitRepositoryInfo) => {
    setSelectedRepo(repo);
    setOpenTabs((prev) => (prev.some((t) => t.path === repo.path) ? prev : [...prev, repo]));
    setViewMode('workspace');
  };

  // Close a repository tab
  const handleCloseTab = (repoPath: string) => {
    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.path !== repoPath);
      if (selectedRepo?.path === repoPath) {
        if (remaining.length > 0) {
          setSelectedRepo(remaining[0]);
        } else {
          setSelectedRepo(null);
          setViewMode('browser');
        }
      }
      return remaining;
    });
  };

  // When selected repo changes, display cached data immediately if available, then refresh in background
  useEffect(() => {
    if (selectedRepo) {
      const cached = repoCache.current.get(selectedRepo.path);
      if (cached) {
        setStatus(cached.status);
        setCommits(cached.commits);
        setBranches(cached.branches);
        setRemotes(cached.remotes);
        setStashes(cached.stashes);
      } else {
        setStatus(null);
        setCommits([]);
        setBranches([]);
        setRemotes([]);
        setStashes([]);
      }
      setWorkspaceView('status');
      setIsBranchModalOpen(false);
      setIsStashModalOpen(false);
      setIsMergeModalOpen(false);
      setRemoteModalType(null);
      loadRepoData(selectedRepo.path);
      setSelectedCommit(null);
      setIsWorkingTreeSelected(true);
      setSelectedFile(null);
      setDiffData(null);
    }
  }, [selectedRepo, loadRepoData]);

  // Load Diff when selected file or commit changes
  useEffect(() => {
    if (!selectedRepo) return;

    const request = ++diffRequest.current;
    const fetchDiff = async () => {
      setIsDiffLoading(true);
      try {
        if (selectedCommit) {
          // Commit diff
          const res = await gitApi.getDiff(selectedRepo.path, {
            commitHash: selectedCommit.hash,
          });
          if (request === diffRequest.current) setDiffData(res);
        } else if (selectedFile) {
          // File diff in working tree
          const res = await gitApi.getDiff(selectedRepo.path, {
            path: selectedFile.path,
            staged: selectedFile.staged,
          });
          if (request === diffRequest.current) setDiffData(res);
        } else if (workspaceView === 'status' && status && !status.isClean) {
          // Auto-select first changed file if none selected
          const firstFile = status.unstaged[0] || status.untracked[0] || status.staged[0];
          if (firstFile) {
            setSelectedFile({
              path: firstFile.path,
              staged: firstFile.staged,
              status: firstFile.status,
            });
          } else {
            setDiffData(null);
          }
        } else {
          setDiffData(null);
        }
      } catch (err: any) {
        console.error('Diff error:', err);
        if (request === diffRequest.current) setDiffData(null);
      } finally {
        if (request === diffRequest.current) setIsDiffLoading(false);
      }
    };

    fetchDiff();
    return () => {
      ++diffRequest.current;
    };
  }, [selectedRepo, selectedCommit, selectedFile, status, workspaceView]);

  // Handle Commit selection
  const handleSelectCommit = (commit: GitCommit | null) => {
    setWorkspaceView('history');
    setSelectedCommit(commit);
    setIsWorkingTreeSelected(false);
    setSelectedFile(null);
  };

  // Handle Working Tree selection
  const handleSelectWorkingTree = () => {
    setWorkspaceView('status');
    setSelectedCommit(null);
    setIsWorkingTreeSelected(true);
  };

  // Staging actions
  const handleStage = async (paths?: string[], all?: boolean) => {
    if (!selectedRepo) return;
    setIsStaging(true);
    try {
      await gitApi.stageFiles({ repoPath: selectedRepo.path, paths, all });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Changes Staged', all ? 'All files staged.' : `${paths?.length || 1} file(s) staged.`);
    } catch (err: any) {
      toast('error', 'Staging Failed', err.message);
    } finally {
      setIsStaging(false);
    }
  };

  const handleUnstage = async (paths?: string[], all?: boolean) => {
    if (!selectedRepo) return;
    setIsStaging(true);
    try {
      await gitApi.unstageFiles({ repoPath: selectedRepo.path, paths, all });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Changes Unstaged', all ? 'All files unstaged.' : `${paths?.length || 1} file(s) unstaged.`);
    } catch (err: any) {
      toast('error', 'Unstaging Failed', err.message);
    } finally {
      setIsStaging(false);
    }
  };

  const handleDiscard = async (paths?: string[], all?: boolean) => {
    if (!selectedRepo) return;
    try {
      await gitApi.discardChanges({ repoPath: selectedRepo.path, paths, all });
      await loadRepoData(selectedRepo.path);
      toast('info', 'Changes Discarded', `${paths?.length || 1} file(s) restored.`);
      if (selectedFile && paths?.includes(selectedFile.path)) {
        setSelectedFile(null);
        setDiffData(null);
      }
    } catch (err: any) {
      toast('error', 'Discard Failed', err.message);
    }
  };

  const handleCommit = async ({ message, amend, pushImmediately }: { message: string; amend?: boolean; pushImmediately?: boolean }) => {
    if (!selectedRepo) return;
    setIsCommitting(true);
    try {
      const res = await gitApi.commit({
        repoPath: selectedRepo.path,
        message,
        amend,
      });
      if (pushImmediately) {
        await gitApi.pushRepo({
          repoPath: selectedRepo.path,
          remote: 'origin',
          branch: selectedRepo.branch,
          force: amend,
        });
      }
      await loadRepoData(selectedRepo.path);
      toast(
        'success',
        amend ? (pushImmediately ? 'Commit Amended & Pushed' : 'Commit Amended') : (pushImmediately ? 'Commit & Pushed' : 'Commit Created'),
        `Branch: ${selectedRepo.branch}${res.commitHash ? ` (${res.commitHash.slice(0, 7)})` : ''}`
      );
    } catch (err: any) {
      toast('error', 'Commit/Push Failed', err.message);
    } finally {
      setIsCommitting(false);
    }
  };

  // Branch actions
  const handleSwitchBranch = async (branchName: string) => {
    if (!selectedRepo) return;
    try {
      await gitApi.switchBranch({ repoPath: selectedRepo.path, branchName });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Switched Branch', `Now on ${branchName}`);
    } catch (err: any) {
      toast('error', 'Switch Branch Failed', err.message);
    }
  };

  const handleCreateBranch = async (branchName: string, startPoint?: string, checkout: boolean = true) => {
    if (!selectedRepo) return;
    try {
      await gitApi.createBranch({ repoPath: selectedRepo.path, branchName, startPoint, checkout });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Branch Created', `Branch ${branchName} created.`);
    } catch (err: any) {
      toast('error', 'Create Branch Failed', err.message);
    }
  };

  // Stash actions
  const handlePushStash = async (message?: string, includeUntracked: boolean = true) => {
    if (!selectedRepo) return;
    try {
      await gitApi.pushStash({ repoPath: selectedRepo.path, message, includeUntracked });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Stash Created', message || 'Changes stashed.');
    } catch (err: any) {
      toast('error', 'Stash Failed', err.message);
    }
  };

  const handlePopStash = async (index?: number) => {
    if (!selectedRepo) return;
    try {
      await gitApi.popStash({ repoPath: selectedRepo.path, index });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Stash Applied', `Stash index ${index ?? 0} applied.`);
    } catch (err: any) {
      toast('error', 'Pop Stash Failed', err.message);
    }
  };

  // Remote actions
  const handleFetch = async (remote?: string, prune?: boolean) => {
    if (!selectedRepo) return;
    try {
      await gitApi.fetchRepo({ repoPath: selectedRepo.path, remote, prune });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Fetch Completed', `Fetched from ${remote || 'origin'}.`);
    } catch (err: any) {
      toast('error', 'Fetch Failed', err.message);
    }
  };

  const handlePull = async (remote?: string, branch?: string, rebase?: boolean) => {
    if (!selectedRepo) return;
    try {
      await gitApi.pullRepo({ repoPath: selectedRepo.path, remote, branch, rebase });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Pull Completed', `Pulled latest changes.`);
    } catch (err: any) {
      toast('error', 'Pull Failed', err.message);
    }
  };

  const handlePush = async (remote?: string, branch?: string, force?: boolean, setUpstream?: boolean) => {
    if (!selectedRepo) return;
    try {
      await gitApi.pushRepo({ repoPath: selectedRepo.path, remote, branch, force, setUpstream });
      await loadRepoData(selectedRepo.path);
      toast('success', 'Push Completed', `Pushed branch to ${remote || 'origin'}.`);
    } catch (err: any) {
      toast('error', 'Push Failed', err.message);
    }
  };

  const runSidebarAction = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      toast('error', 'Git operation failed', error instanceof Error ? error.message : 'Operation failed.');
    }
  };

  const handleMerge = async (branch: string, noFF: boolean, message?: string) => {
    if (!selectedRepo) return;
    try {
      await gitApi.merge({ repoPath: selectedRepo.path, branch, noFf: noFF, message });
      toast('success', 'Merge Completed', `Merged ${branch}.`);
    } finally {
      await loadRepoData(selectedRepo.path);
    }
  };

  const handleViewRemote = async () => {
    if (!selectedRepo) return;
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    try {
      const result = await gitApi.getRemoteWebUrl(selectedRepo.path);
      const url = new URL(result.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported remote URL.');
      if (!popup) throw new Error('Allow popups to open the remote repository.');
      popup.location.href = url.href;
    } catch (error) {
      popup?.close();
      throw error;
    }
  };

  const handleOpenCreatePR = async () => {
    if (!selectedRepo) return;
    try {
      const result = await gitApi.getRemoteWebUrl(selectedRepo.path);
      setRepoWebUrl(result.url);
    } catch {
      setRepoWebUrl('');
    }
    setIsCreatePRModalOpen(true);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[640px] bg-white rounded-2xl border border-app-line overflow-hidden shadow-soft animate-scale-in">
      {/* Top macOS-style Navigation & Repository Tabs Bar */}
      <div
        role="tablist"
        aria-label="Repository Tabs"
        className="shrink-0 h-10 px-2 bg-[#dce3ec] border-b border-app-line flex items-center justify-between gap-1 select-none"
      >
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
          {/* Back arrow button: returns to Repositories list */}
          <button
            type="button"
            onClick={() => setViewMode('browser')}
            className={`p-1.5 rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-300/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 transition-colors shrink-0 ${
              viewMode === 'browser' ? 'bg-slate-300/80 font-bold' : ''
            }`}
            title="Back to Repositories list"
            aria-label="Back to Repositories"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Repositories Bookmarks Tab */}
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'browser'}
            onClick={() => setViewMode('browser')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs transition-colors shrink-0 ${
              viewMode === 'browser'
                ? 'bg-white text-slate-900 font-semibold shadow-xs border-t-2 border-brand-600'
                : 'text-slate-600 hover:bg-slate-300/40'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5 text-brand-600" />
            <span>Repositories</span>
          </button>

          {/* Open Repository Tabs */}
          {openTabs.map((tab) => {
            const isActive = viewMode === 'workspace' && selectedRepo?.path === tab.path;
            const hasChanges = tab.stagedCount + tab.unstagedCount + tab.untrackedCount > 0;

            return (
              <div
                key={tab.path}
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setSelectedRepo(tab);
                  setViewMode('workspace');
                }}
                className={`group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-t-lg text-xs cursor-pointer transition-colors shrink-0 ${
                  isActive
                    ? 'bg-white text-slate-900 font-semibold shadow-xs border-t-2 border-brand-600'
                    : 'text-slate-600 hover:bg-slate-300/40'
                }`}
              >
                {hasChanges && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Uncommitted changes" />
                )}
                <span className="truncate max-w-[140px]" title={tab.name}>
                  {tab.name}
                </span>

                {/* Close Tab button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.path);
                  }}
                  className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200 opacity-60 group-hover:opacity-100 transition-all ml-1"
                  title="Close repository tab"
                  aria-label={`Close ${tab.name} tab`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Add / New Tab Button (+) */}
          <button
            type="button"
            onClick={() => setViewMode('browser')}
            className="p-1 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-300/60 transition-colors shrink-0 ml-0.5"
            title="Open another repository"
            aria-label="Open another repository"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Current Active Repo & Branch Info */}
        {selectedRepo && viewMode === 'workspace' && (
          <div className="hidden lg:flex items-center gap-2 text-[11px] text-slate-600 shrink-0 pr-2">
            <span className="font-semibold text-slate-800">{selectedRepo.name}</span>
            <span className="text-slate-400">/</span>
            <span className="font-mono text-brand-600 font-bold">
              {status?.branch || selectedRepo.currentBranch}
            </span>
          </div>
        )}
      </div>

      {/* Main Content: Either Repository Browser or SourceTree Workspace */}
      {viewMode === 'browser' || !selectedRepo ? (
        <GitRepoBrowser
          repositories={repositories}
          onSelectRepo={handleSelectRepo}
          onScan={handleScan}
          isScanning={isScanning}
          defaultRootPath={initialRootPath}
          onOpenFinder={(path) => void runSidebarAction(() => gitApi.openInFinder(path))}
          onOpenTerminal={(path) => void runSidebarAction(() => gitApi.openTerminal(path))}
          onRefresh={() => handleScan(initialRootPath, 4)}
          isRefreshing={isScanning}
        />
      ) : (
        /* SourceTree Workspace View */
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Header Toolbar */}
          <GitToolbar
            selectedRepo={selectedRepo}
            status={status}
            onOpenBranchModal={() => setIsBranchModalOpen(true)}
            onOpenStashModal={() => setIsStashModalOpen(true)}
            onOpenRemoteModal={(type) => setRemoteModalType(type)}
            onRefresh={() => selectedRepo && loadRepoData(selectedRepo.path)}
            isRefreshing={isRefreshing}
            onCommit={handleSelectWorkingTree}
            onOpenMergeModal={() => setIsMergeModalOpen(true)}
            onOpenCreatePRModal={handleOpenCreatePR}
            onViewRemote={() => void runSidebarAction(handleViewRemote)}
            onOpenFinder={() => selectedRepo && void runSidebarAction(() => gitApi.openInFinder(selectedRepo.path))}
            onOpenTerminal={() => selectedRepo && void runSidebarAction(() => gitApi.openTerminal(selectedRepo.path))}
            searchQuery={toolbarSearch}
            onSearchChange={setToolbarSearch}
          />

          {/* Main 2-Panel Split: Left Sidebar + Workspace Content */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
            {/* Left Sidebar */}
            <GitRepoSidebar
              repositories={repositories}
              selectedRepo={selectedRepo}
              onSelectRepo={handleSelectRepo}
              onScan={handleScan}
              isScanning={isScanning}
              defaultRootPath={initialRootPath}
              onRefreshActive={() => selectedRepo && loadRepoData(selectedRepo.path)}
              isRefreshingActive={isRefreshing}
              status={status}
              workspaceView={workspaceView}
              onWorkspaceView={(view) => {
                setWorkspaceView(view);
                setSelectedCommit(null);
                setSelectedFile(null);
                setDiffData(null);
              }}
              branches={branches}
              remotes={remotes}
              commits={commits}
              stashes={stashes}
              onCheckout={(name) => void runSidebarAction(() => handleSwitchBranch(name))}
              onCreateBranch={() => setIsBranchModalOpen(true)}
              onFetch={(remote) => void runSidebarAction(() => handleFetch(remote, true))}
              onPopStash={(index) => void runSidebarAction(() => handlePopStash(index))}
              onSelectCommit={handleSelectCommit}
            />

            {/* Workspace Center/Right View */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {workspaceView === 'history' ? (
                <div className="flex-1 overflow-hidden">
                  <GitCommitGraph
                    commits={commits}
                    selectedCommit={selectedCommit}
                    onSelectCommit={handleSelectCommit}
                    hasWorkingTreeChanges={status ? !status.isClean : false}
                    isWorkingTreeSelected={isWorkingTreeSelected}
                    onSelectWorkingTree={handleSelectWorkingTree}
                    currentBranch={status?.branch}
                  />
                </div>
              ) : (
                /* SourceTree File Status & Diff Split View */
                <GitSourceTreeFileStatus
                  status={status}
                  diffData={diffData}
                  selectedFile={selectedFile}
                  onSelectFile={(f) => {
                    setSelectedFile(f);
                    setSelectedCommit(null);
                    setIsWorkingTreeSelected(true);
                  }}
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                  onDiscard={handleDiscard}
                  onCommit={handleCommit}
                  isStaging={isStaging}
                  isCommitting={isCommitting}
                  isDiffLoading={isDiffLoading}
                  lastCommitMessage={commits[0]?.message}
                  selectedCommit={selectedCommit}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedRepo && (
        <>
          <MergeModal
            key={`merge-${selectedRepo.path}`}
            isOpen={isMergeModalOpen}
            onClose={() => setIsMergeModalOpen(false)}
            branches={branches}
            currentBranch={status?.branch || selectedRepo.currentBranch}
            onMerge={handleMerge}
          />
          <BranchModal
            isOpen={isBranchModalOpen}
            onClose={() => setIsBranchModalOpen(false)}
            branches={branches}
            currentBranch={status?.branch || selectedRepo.currentBranch}
            onSwitchBranch={handleSwitchBranch}
            onCreateBranch={handleCreateBranch}
          />
          <StashModal
            isOpen={isStashModalOpen}
            onClose={() => setIsStashModalOpen(false)}
            stashes={stashes}
            onPushStash={handlePushStash}
            onPopStash={handlePopStash}
          />
          <CreatePRModal
            isOpen={isCreatePRModalOpen}
            onClose={() => setIsCreatePRModalOpen(false)}
            currentBranch={status?.branch || selectedRepo.currentBranch}
            repoWebUrl={repoWebUrl}
            repoName={selectedRepo.name}
          />
          <RemoteOpsModal
            isOpen={remoteModalType !== null}
            type={remoteModalType}
            onClose={() => setRemoteModalType(null)}
            currentBranch={status?.branch || selectedRepo.currentBranch}
            onFetch={handleFetch}
            onPull={handlePull}
            onPush={handlePush}
          />
        </>
      )}
    </div>
  );
};
