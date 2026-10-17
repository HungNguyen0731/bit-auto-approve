import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { GitRepoSidebar } from '../components/git/GitRepoSidebar';
import { GitCommitGraph } from '../components/git/GitCommitGraph';
import { GitStagingPanel } from '../components/git/GitStagingPanel';
import { GitDiffViewer } from '../components/git/GitDiffViewer';
import { GitToolbar } from '../components/git/GitToolbar';
import { BranchModal, StashModal, MergeModal, CreatePRModal } from '../components/git/GitModals';
import { GitManager } from '../components/git/GitManager';
import { gitApi } from '../api/gitClient';
import type {
  GitCommit,
  GitDiffResponse,
  GitRepositoryInfo,
  GitWorkingTreeStatus,
} from '../types/git';

// Mock gitApi
vi.mock('../api/gitClient', () => ({
  gitApi: {
    scanRepositories: vi.fn(),
    getRepositories: vi.fn(),
    getStatus: vi.fn(),
    getCommits: vi.fn(),
    getDiff: vi.fn(),
    getBranches: vi.fn(),
    getRemotes: vi.fn().mockResolvedValue([]),
    getRemoteWebUrl: vi.fn(),
    merge: vi.fn(),
    openInFinder: vi.fn(),
    openTerminal: vi.fn(),
    createBranch: vi.fn(),
    switchBranch: vi.fn(),
    stageFiles: vi.fn(),
    unstageFiles: vi.fn(),
    discardChanges: vi.fn(),
    commit: vi.fn(),
    getStashes: vi.fn(),
    pushStash: vi.fn(),
    popStash: vi.fn(),
    fetchRepo: vi.fn(),
    pullRepo: vi.fn(),
    pushRepo: vi.fn(),
  },
}));

describe('Git Manager Frontend Components', () => {
  const mockRepo1: GitRepositoryInfo = {
    name: 'repo-alpha',
    path: '/projects/repo-alpha',
    currentBranch: 'main',
    isClean: true,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    ahead: 0,
    behind: 0,
    lastCommitHash: 'a1b2c3d4e5f6',
    lastCommitMessage: 'feat: initial release',
    lastCommitAuthor: 'Alice Developer',
    lastCommitDate: '2025-01-01T10:00:00Z',
  };

  const mockRepo2: GitRepositoryInfo = {
    name: 'repo-beta',
    path: '/projects/repo-beta',
    currentBranch: 'feature/diff-viewer',
    isClean: false,
    stagedCount: 2,
    unstagedCount: 1,
    untrackedCount: 1,
    ahead: 2,
    behind: 1,
    lastCommitHash: 'b2c3d4e5f6a1',
    lastCommitMessage: 'wip: diff layout',
    lastCommitAuthor: 'Bob Engineer',
    lastCommitDate: '2025-01-02T12:00:00Z',
  };

  const mockCommits: GitCommit[] = [
    {
      hash: 'commit-2-hash-1234567890',
      shortHash: 'c2hash1',
      parents: ['commit-1-hash-1234567890'],
      authorName: 'Charlie',
      authorEmail: 'charlie@example.com',
      date: '2025-01-03T15:00:00Z',
      message: 'feat: add DAG commit tree visualizer',
      refs: [
        { name: 'HEAD', type: 'head', fullName: 'HEAD' },
        { name: 'feature/graph', type: 'branch', fullName: 'refs/heads/feature/graph' },
      ],
    },
    {
      hash: 'commit-1-hash-1234567890',
      shortHash: 'c1hash1',
      parents: [],
      authorName: 'Alice',
      authorEmail: 'alice@example.com',
      date: '2025-01-01T10:00:00Z',
      message: 'chore: initial commit',
      refs: [
        { name: 'main', type: 'branch', fullName: 'refs/heads/main' },
        { name: 'v1.0.0', type: 'tag', fullName: 'refs/tags/v1.0.0' },
      ],
    },
  ];

  const mockWorkingTreeStatus: GitWorkingTreeStatus = {
    branch: 'feature/diff-viewer',
    upstream: 'origin/feature/diff-viewer',
    ahead: 2,
    behind: 1,
    isClean: false,
    staged: [
      { path: 'src/components/GitGraph.tsx', status: 'modified', staged: true },
      { path: 'src/types/git.ts', status: 'added', staged: true },
    ],
    unstaged: [
      { path: 'src/components/GitStaging.tsx', status: 'modified', staged: false },
    ],
    untracked: [
      { path: 'notes.txt', status: 'untracked', staged: false },
    ],
  };

  const mockDiff: GitDiffResponse = {
    rawDiff: 'diff --git a/file.ts b/file.ts\n@@ -1,2 +1,3 @@\n context\n+new line\n',
    files: [
      {
        oldPath: 'src/components/GitGraph.tsx',
        newPath: 'src/components/GitGraph.tsx',
        isNew: false,
        isDeleted: false,
        isRenamed: false,
        isBinary: false,
        additions: 15,
        deletions: 3,
        rawDiff: '@@ -1,5 +1,6 @@\n+export const GitGraph = () => {};',
        hunks: [
          {
            header: '@@ -1,5 +1,6 @@',
            oldStart: 1,
            oldLines: 5,
            newStart: 1,
            newLines: 6,
            lines: [
              { type: 'context', content: 'import React from "react";', oldLineNumber: 1, newLineNumber: 1 },
              { type: 'deletion', content: '-const old = 1;', oldLineNumber: 2 },
              { type: 'addition', content: '+const updated = 2;', newLineNumber: 2 },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('1. GitRepoSidebar Component', () => {
    it('renders repository list with status indicators and search filter', () => {
      const onSelectRepo = vi.fn();
      const onScan = vi.fn();

      render(
        <GitRepoSidebar
          repositories={[mockRepo1, mockRepo2]}
          selectedRepo={mockRepo1}
          onSelectRepo={onSelectRepo}
          onScan={onScan}
          isScanning={false}
          defaultRootPath="/my-root"
        />
      );

      // Verify header and repos
      expect(screen.getByText('Local Repositories')).toBeInTheDocument();
      expect(screen.getByText('2 found')).toBeInTheDocument();
      expect(screen.getByText('repo-alpha')).toBeInTheDocument();
      expect(screen.getByText('repo-beta')).toBeInTheDocument();

      expect(screen.getByRole('combobox', { name: 'Repository' })).toHaveValue(mockRepo1.path);
      expect(screen.getByRole('button', { name: /File Status/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();

      // Filter repos
      const searchInput = screen.getByLabelText('Filter repositories');
      fireEvent.change(searchInput, { target: { value: 'beta' } });

      expect(screen.queryByText('repo-alpha')).not.toBeInTheDocument();
      expect(screen.getByText('repo-beta')).toBeInTheDocument();

      // Click to select
      fireEvent.change(screen.getByRole('combobox', { name: 'Repository' }), { target: { value: mockRepo2.path } });
      expect(onSelectRepo).toHaveBeenCalledWith(mockRepo2);
    });

    it('submits directory scan with specified depth', () => {
      const onScan = vi.fn();
      render(
        <GitRepoSidebar
          repositories={[]}
          selectedRepo={null}
          onSelectRepo={vi.fn()}
          onScan={onScan}
          isScanning={false}
          defaultRootPath="/custom/path"
        />
      );

      const pathInput = screen.getByLabelText('Scan directory path');
      fireEvent.change(pathInput, { target: { value: '/new/scan/path' } });

      const depthSelect = screen.getByLabelText('Scan Depth');
      fireEvent.change(depthSelect, { target: { value: '6' } });

      const scanBtn = screen.getByRole('button', { name: /scan directory/i });
      fireEvent.click(scanBtn);

      expect(onScan).toHaveBeenCalledWith('/new/scan/path', 6);
    });
  });

  describe('2. GitCommitGraph Component', () => {
    it('renders commit history DAG with branches, authors, hashes, and SVG nodes', () => {
      const onSelectCommit = vi.fn();
      const onSelectWorkingTree = vi.fn();

      render(
        <GitCommitGraph
          commits={mockCommits}
          selectedCommit={mockCommits[0]}
          onSelectCommit={onSelectCommit}
          hasWorkingTreeChanges={true}
          isWorkingTreeSelected={false}
          onSelectWorkingTree={onSelectWorkingTree}
          currentBranch="main"
        />
      );

      expect(screen.getByText('Commit History (DAG)')).toBeInTheDocument();
      expect(screen.getByText('2 commits')).toBeInTheDocument();

      // Check commit messages & refs
      expect(screen.getByText('feat: add DAG commit tree visualizer')).toBeInTheDocument();
      expect(screen.getByText('HEAD')).toBeInTheDocument();
      expect(screen.getByText('feature/graph')).toBeInTheDocument();
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();

      // Check working tree row
      const wtRow = screen.getByText('Uncommitted Changes (Working Tree)');
      expect(wtRow).toBeInTheDocument();
      fireEvent.click(wtRow);
      expect(onSelectWorkingTree).toHaveBeenCalled();

      // Click second commit
      const secondCommit = screen.getByText('chore: initial commit');
      fireEvent.click(secondCommit);
      expect(onSelectCommit).toHaveBeenCalledWith(mockCommits[1]);
    });

    it('filters commits by search query', () => {
      render(
        <GitCommitGraph
          commits={mockCommits}
          selectedCommit={null}
          onSelectCommit={vi.fn()}
        />
      );

      const searchInput = screen.getByLabelText('Filter commits');
      fireEvent.change(searchInput, { target: { value: 'initial' } });

      expect(screen.getByText('chore: initial commit')).toBeInTheDocument();
      expect(screen.queryByText('feat: add DAG commit tree visualizer')).not.toBeInTheDocument();
    });
  });

  describe('3. GitStagingPanel Component', () => {
    it('renders unstaged and staged files with stage, unstage, and commit actions', () => {
      const onStage = vi.fn();
      const onUnstage = vi.fn();
      const onCommit = vi.fn();
      const onSelectFile = vi.fn();

      render(
        <GitStagingPanel
          status={mockWorkingTreeStatus}
          selectedFile={null}
          onSelectFile={onSelectFile}
          onStage={onStage}
          onUnstage={onUnstage}
          onDiscard={vi.fn()}
          onCommit={onCommit}
        />
      );

      // Verify staged count (2) and unstaged + untracked count (2)
      expect(screen.getByText('Unstaged Files')).toBeInTheDocument();
      expect(screen.getByText('Staged Files')).toBeInTheDocument();
      expect(screen.getByText('src/components/GitStaging.tsx')).toBeInTheDocument();
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
      expect(screen.getByText('src/components/GitGraph.tsx')).toBeInTheDocument();

      // Stage All
      const stageAllBtn = screen.getByTitle('Stage all unstaged changes');
      fireEvent.click(stageAllBtn);
      expect(onStage).toHaveBeenCalledWith(undefined, true);

      // Unstage All
      const unstageAllBtn = screen.getByTitle('Unstage all staged files');
      fireEvent.click(unstageAllBtn);
      expect(onUnstage).toHaveBeenCalledWith(undefined, true);

      // Commit form
      const commitInput = screen.getByPlaceholderText(/write a clear commit message/i);
      fireEvent.change(commitInput, { target: { value: 'feat: ready to ship' } });

      const commitBtn = screen.getByRole('button', { name: /commit/i });
      fireEvent.click(commitBtn);
      expect(onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'feat: ready to ship',
          amend: false,
        })
      );
    });

    it('supports amend commit option', () => {
      const onCommit = vi.fn();
      render(
        <GitStagingPanel
          status={mockWorkingTreeStatus}
          selectedFile={null}
          onSelectFile={vi.fn()}
          onStage={vi.fn()}
          onUnstage={vi.fn()}
          onDiscard={vi.fn()}
          onCommit={onCommit}
          lastCommitMessage="previous commit subject"
        />
      );

      const amendCheckbox = screen.getByLabelText(/amend previous commit/i);
      fireEvent.click(amendCheckbox);

      const commitInput = screen.getByPlaceholderText(/write a clear commit message/i);
      expect(commitInput).toHaveValue('previous commit subject');
    });

    it('supports selecting unstaged files via checkboxes and staging only upon commit', () => {
      const onStage = vi.fn();
      const onCommit = vi.fn();
      render(
        <GitStagingPanel
          status={mockWorkingTreeStatus}
          selectedFile={null}
          onSelectFile={vi.fn()}
          onStage={onStage}
          onUnstage={vi.fn()}
          onDiscard={vi.fn()}
          onCommit={onCommit}
        />
      );

      // Checkbox for unstaged file
      const selectFileBtn = screen.getByRole('button', { name: 'Select src/components/GitStaging.tsx' });
      fireEvent.click(selectFileBtn);

      // onStage was NOT called immediately (preventing UI lag!)
      expect(onStage).not.toHaveBeenCalled();

      // Button now says Deselect
      expect(screen.getByRole('button', { name: 'Deselect src/components/GitStaging.tsx' })).toBeInTheDocument();

      // Enter commit message
      const commitInput = screen.getByPlaceholderText(/write a clear commit message/i);
      fireEvent.change(commitInput, { target: { value: 'feat: lazy staging on commit' } });

      const commitBtn = screen.getByRole('button', { name: /commit/i });
      fireEvent.click(commitBtn);

      // onCommit is called with stagePaths containing the selected unstaged file
      expect(onCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'feat: lazy staging on commit',
          stagePaths: ['src/components/GitStaging.tsx'],
        })
      );
    });
  });

  describe('4. GitDiffViewer Component', () => {
    it('renders diff hunks, additions, deletions, and line numbers', () => {
      render(
        <GitDiffViewer
          diffData={mockDiff}
          selectedFilePath="src/components/GitGraph.tsx"
        />
      );

      expect(screen.getByText('src/components/GitGraph.tsx')).toBeInTheDocument();
      expect(screen.getByText('+15')).toBeInTheDocument();
      expect(screen.getByText('-3')).toBeInTheDocument();
      expect(screen.getByText('@@ -1,5 +1,6 @@')).toBeInTheDocument();
      expect(screen.getByText('import React from "react";')).toBeInTheDocument();
      expect(screen.getByText('-const old = 1;')).toBeInTheDocument();
      expect(screen.getByText('+const updated = 2;')).toBeInTheDocument();
    });

    it('toggles between unified and raw diff views', () => {
      render(
        <GitDiffViewer
          diffData={mockDiff}
          selectedFilePath="src/components/GitGraph.tsx"
        />
      );

      const rawBtn = screen.getByText('Raw');
      fireEvent.click(rawBtn);

      expect(screen.getByText(/export const GitGraph/)).toBeInTheDocument();
    });
  });

  describe('5. GitToolbar and Modals', () => {
    it('renders toolbar actions and opens Branch, Stash, and Remote modals', async () => {
      const onOpenBranch = vi.fn();
      const onOpenStash = vi.fn();
      const onOpenRemote = vi.fn();
      const onRefresh = vi.fn();
      const onOpenCreatePR = vi.fn();

      render(
        <GitToolbar
          selectedRepo={mockRepo2}
          status={mockWorkingTreeStatus}
          onOpenBranchModal={onOpenBranch}
          onOpenStashModal={onOpenStash}
          onOpenRemoteModal={onOpenRemote}
          onRefresh={onRefresh}
          onOpenCreatePRModal={onOpenCreatePR}
        />
      );

      expect(screen.getByRole('button', { name: 'Commit' })).toHaveTextContent('2');
      expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tạo PR' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View Remote' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show in Finder' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument();

      fireEvent.click(screen.getByTitle('Tạo Pull Request từ nhánh hiện tại vào dev, qc hoặc uat'));
      expect(onOpenCreatePR).toHaveBeenCalled();

      fireEvent.click(screen.getByTitle('Branch management'));
      expect(onOpenBranch).toHaveBeenCalled();

      fireEvent.click(screen.getByTitle('Stash management'));
      expect(onOpenStash).toHaveBeenCalled();

      fireEvent.click(screen.getByTitle('Pull and merge latest remote commits'));
      expect(onOpenRemote).toHaveBeenCalledWith('pull');
    });

    it('submits merge options and exposes merge failures', async () => {
      const onMerge = vi.fn().mockRejectedValue(new Error('Merge conflicts'));
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
      Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
      render(<MergeModal isOpen onClose={vi.fn()} currentBranch="main" branches={[{ name: 'main', current: true, commitHash: 'a', isRemote: false }, { name: 'dev', current: false, commitHash: 'b', isRemote: false }]} onMerge={onMerge} />);
      fireEvent.change(screen.getByLabelText('Branch to merge'), { target: { value: 'dev' } });
      fireEvent.click(screen.getByLabelText(/Always create a merge commit/));
      fireEvent.change(screen.getByLabelText('Custom message (optional)'), { target: { value: 'Merge dev' } });
      fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
      await screen.findByRole('alert');
      expect(screen.getByRole('alert')).toHaveTextContent('Merge conflicts');
      expect(onMerge).toHaveBeenCalledWith('dev', true, 'Merge dev');
      vi.restoreAllMocks();
    });

    it('handles BranchModal branch switching and creation', async () => {
      const onSwitch = vi.fn().mockResolvedValue(undefined);
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();

      render(
        <BranchModal
          isOpen={true}
          onClose={onClose}
          branches={[
            { name: 'main', current: true, commitHash: 'abc', isRemote: false },
            { name: 'dev', current: false, commitHash: 'def', isRemote: false },
          ]}
          currentBranch="main"
          onSwitchBranch={onSwitch}
          onCreateBranch={onCreate}
        />
      );

      expect(screen.getByText('Branch Management')).toBeInTheDocument();
      expect(screen.getByText('main')).toBeInTheDocument();
      expect(screen.getByText('dev')).toBeInTheDocument();

      // Click checkout dev
      const checkoutBtn = screen.getByRole('button', { name: /checkout/i });
      fireEvent.click(checkoutBtn);
      await waitFor(() => {
        expect(onSwitch).toHaveBeenCalledWith('dev');
      });
    });

    it('handles StashModal push and pop', async () => {
      const onPushStash = vi.fn().mockResolvedValue(undefined);
      const onPopStash = vi.fn().mockResolvedValue(undefined);

      render(
        <StashModal
          isOpen={true}
          onClose={vi.fn()}
          stashes={[
            { index: 0, message: 'WIP on graph', date: '2025-01-01', hash: 'stash1' },
          ]}
          onPushStash={onPushStash}
          onPopStash={onPopStash}
        />
      );

      expect(screen.getByText('Stash Management')).toBeInTheDocument();
      expect(screen.getByText('WIP on graph')).toBeInTheDocument();

      // Pop stash
      const popBtn = screen.getByRole('button', { name: /pop \/ apply/i });
      fireEvent.click(popBtn);
      await waitFor(() => {
        expect(onPopStash).toHaveBeenCalledWith(0);
      });
    });

    it('renders CreatePRModal with dev/qc/uat quick targets and opens Bitbucket PR URL', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const onClose = vi.fn();

      render(
        <CreatePRModal
          isOpen={true}
          onClose={onClose}
          currentBranch="feature/new-header-pr"
          repoWebUrl="https://bitbucket.org/digifactory/my-service"
          repoName="my-service"
        />
      );

      expect(screen.getByText('Tạo Pull Request (Bitbucket)')).toBeInTheDocument();
      expect(screen.getAllByText('feature/new-header-pr').length).toBeGreaterThanOrEqual(1);

      // Click qc target
      const qcButton = screen.getByRole('button', { name: /qc Testing \/ QA/i });
      fireEvent.click(qcButton);

      // Click open PR button
      const submitBtn = screen.getByRole('button', { name: /Tạo PR vào 'qc'/i });
      fireEvent.click(submitBtn);

      expect(openSpy).toHaveBeenCalledWith(
        'https://bitbucket.org/digifactory/my-service/pull-requests/new?source=feature%2Fnew-header-pr&dest=qc',
        '_blank',
        'noopener,noreferrer'
      );
      expect(onClose).toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  describe('6. GitManager Orchestrator Flow', () => {
    it('loads repositories on mount and handles repository selection and operations', async () => {
      vi.mocked(gitApi.scanRepositories).mockResolvedValue({
        rootPath: '.',
        repositories: [mockRepo1],
      });
      vi.mocked(gitApi.getStatus).mockResolvedValue(mockWorkingTreeStatus);
      vi.mocked(gitApi.getCommits).mockResolvedValue(mockCommits);
      vi.mocked(gitApi.getBranches).mockResolvedValue([
        { name: 'main', current: true, commitHash: 'abc', isRemote: false },
        { name: 'dev', current: false, commitHash: 'def', isRemote: false },
        { name: 'origin/main', current: false, commitHash: 'abc', isRemote: true },
      ]);
      vi.mocked(gitApi.getRemotes).mockResolvedValue([{ name: 'origin', url: 'https://example.com/repo.git', pushUrl: 'https://example.com/repo.git' }]);
      vi.mocked(gitApi.getStashes).mockResolvedValue([{ index: 0, message: 'Work in progress', hash: 'stash', date: '2025-01-01' }]);
      vi.mocked(gitApi.openInFinder).mockResolvedValue({ success: true });
      vi.mocked(gitApi.openTerminal).mockResolvedValue({ success: true });
      vi.mocked(gitApi.getDiff).mockResolvedValue(mockDiff);

      const onShowToast = vi.fn();

      render(<GitManager onShowToast={onShowToast} initialRootPath="." />);

      // Wait for repository scan and loading
      await waitFor(() => {
        expect(gitApi.scanRepositories).toHaveBeenCalledWith('.', 4);
      });

      await waitFor(() => {
        expect(screen.getAllByText('repo-alpha').length).toBeGreaterThanOrEqual(1);
      });

      // User selects repo-alpha from Repository Browser to open workspace
      fireEvent.click(screen.getByRole('button', { name: /open workspace/i }));

      await screen.findByText('Staged Files');
      expect(screen.getByTitle('origin/main')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'v1.0.0' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pop / Apply stash 0' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Show in Finder' }));
      fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
      await waitFor(() => expect(gitApi.openInFinder).toHaveBeenCalledWith(mockRepo1.path));
      expect(gitApi.openTerminal).toHaveBeenCalledWith(mockRepo1.path);
      expect(screen.queryByText('Commit History (DAG)')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'History' }));
      // Verify history view loads on navigation
      await waitFor(() => {
        expect(screen.getByText('Commit History (DAG)')).toBeInTheDocument();
      });
    });
  });

  describe('7. App Navigation Integration', () => {
    it('renders "Git Manager" tab and switches to Git Manager view', async () => {
      // Mock global fetch for App's initial loadData
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/api/session')) {
            return new Response(JSON.stringify({ success: true, data: { authenticated: true } }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (url.includes('/api/status')) {
            return new Response(
              JSON.stringify({
                success: true,
                data: {
                  isRunning: false,
                  activeJobsCount: 0,
                  totalJobsCount: 0,
                  vpnConnected: false,
                  bitbucketStatus: 'UNCONFIGURED',
                  totalApprovedCount: 0,
                  uptimeSeconds: 0,
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          if (url.includes('/api/config/test')) {
            return new Response(
              JSON.stringify({
                success: true,
                data: {
                  success: true,
                  user: {
                    username: 'alice',
                    displayName: 'Alice Developer',
                  },
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          if (url.includes('/api/config')) {
            return new Response(
              JSON.stringify({
                success: true,
                data: {
                  serverType: 'cloud',
                  baseUrl: 'https://api.bitbucket.org/2.0',
                  authType: 'basic',
                  hasToken: true,
                  workspace: 'test-workspace',
                  skipSslVerification: false,
                  timeoutMs: 15000,
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          if (url.includes('/api/jobs')) {
            return new Response(JSON.stringify({ success: true, data: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (url.includes('/api/logs') || url.includes('/worker')) {
            return new Response(JSON.stringify({ success: true, data: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          if (url.includes('/api/git/scan')) {
            return new Response(
              JSON.stringify({
                success: true,
                data: { rootPath: '.', repositories: [mockRepo1] },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          return new Response(JSON.stringify({ success: true, data: {} }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        })
      );

      const { App } = await import('../App');
      render(<App />);

      const gitTabBtn = await screen.findByTestId('tab-git-manager');
      expect(gitTabBtn).toBeInTheDocument();
      expect(gitTabBtn).toHaveTextContent('Git Manager');

      fireEvent.click(gitTabBtn);

      await waitFor(() => {
        expect(screen.getAllByText('repo-alpha').length).toBeGreaterThanOrEqual(1);
      });

      // User selects repo-alpha from Repository Browser to open workspace
      fireEvent.click(screen.getByRole('button', { name: /open workspace/i }));

      await waitFor(() => {
        expect(screen.getByLabelText('Git Repositories Sidebar')).toBeInTheDocument();
      });
    });
  });

  describe('8. SourceTree Workflow, Tabs, and Complete Navigation', () => {
    it('manages repository tabs, back navigation, and SourceTree toolbar/sidebar features', async () => {
      vi.mocked(gitApi.scanRepositories).mockResolvedValue({
        rootPath: '.',
        repositories: [mockRepo1, mockRepo2],
      });
      vi.mocked(gitApi.getStatus).mockResolvedValue(mockWorkingTreeStatus);
      vi.mocked(gitApi.getCommits).mockResolvedValue(mockCommits);
      vi.mocked(gitApi.getBranches).mockResolvedValue([
        { name: 'main', current: true, commitHash: 'abc', isRemote: false },
        { name: 'feature/diff-viewer', current: false, commitHash: 'def', isRemote: false },
        { name: 'dev', current: false, commitHash: 'ghi', isRemote: false },
        { name: 'origin/main', current: false, commitHash: 'abc', isRemote: true },
      ]);
      vi.mocked(gitApi.getRemotes).mockResolvedValue([
        { name: 'origin', url: 'https://example.com/repo.git', pushUrl: 'https://example.com/repo.git' },
      ]);
      vi.mocked(gitApi.getStashes).mockResolvedValue([]);
      vi.mocked(gitApi.getDiff).mockResolvedValue(mockDiff);

      render(<GitManager initialRootPath="." />);

      // 1. Initial screen is the Repository Browser
      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'Repositories Browser' })).toBeInTheDocument();
      });
      expect(screen.getByText('repo-alpha')).toBeInTheDocument();
      expect(screen.getByText('repo-beta')).toBeInTheDocument();

      // 2. Click repo-alpha to open SourceTree workspace
      const openWorkspaceBtns = screen.getAllByRole('button', { name: /open workspace/i });
      await act(async () => {
        fireEvent.click(openWorkspaceBtns[0]);
      });

      // Workspace loaded with Git Toolbar and Sidebar
      await screen.findByRole('group', { name: 'Git Action Toolbar' });
      expect(screen.getByRole('button', { name: 'Commit' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pull' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Push' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Fetch' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Branch' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stash' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View Remote' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show in Finder' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Terminal' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByLabelText('Search')).toBeInTheDocument();

      // Sidebar features
      expect(screen.getByLabelText('Git Repositories Sidebar')).toBeInTheDocument();
      expect(screen.getByText('WORKSPACE')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /file status/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
      expect(screen.getByText('BRANCHES')).toBeInTheDocument();
      expect(screen.getByLabelText('Current branch')).toBeInTheDocument(); // active blue dot
      expect(screen.getByText('feature')).toBeInTheDocument(); // folder node
      expect(screen.getByText('REMOTES')).toBeInTheDocument();
      expect(screen.getByText('origin')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter sidebar items')).toBeInTheDocument();

      // 3. Tab bar shows repo-alpha
      expect(screen.getByRole('tab', { name: /repo-alpha/i })).toBeInTheDocument();

      // 4. Click Back arrow to return to Repositories list
      const backBtn = screen.getByRole('button', { name: 'Back to Repositories' });
      await act(async () => {
        fireEvent.click(backBtn);
      });

      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'Repositories Browser' })).toBeInTheDocument();
      });

      // 5. Open repo-beta from browser
      const openBetaBtn = screen.getAllByRole('button', { name: /open workspace/i })[1];
      await act(async () => {
        fireEvent.click(openBetaBtn);
      });

      // Now both tabs should exist in tab bar
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /repo-alpha/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /repo-beta/i })).toBeInTheDocument();
      });

      // 6. Click '+' button to go back to Repositories Browser
      const plusBtn = screen.getByRole('button', { name: 'Open another repository' });
      await act(async () => {
        fireEvent.click(plusBtn);
      });

      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'Repositories Browser' })).toBeInTheDocument();
      });

      // 7. Click repo-alpha tab to switch back
      await act(async () => {
        fireEvent.click(screen.getByRole('tab', { name: /repo-alpha/i }));
      });
      await waitFor(() => {
        expect(screen.getByRole('group', { name: 'Git Action Toolbar' })).toBeInTheDocument();
      });

      // 8. Close repo-alpha tab
      const closeAlphaBtn = screen.getByRole('button', { name: 'Close repo-alpha tab' });
      await act(async () => {
        fireEvent.click(closeAlphaBtn);
      });

      // repo-alpha tab is removed
      expect(screen.queryByRole('button', { name: 'Close repo-alpha tab' })).not.toBeInTheDocument();
    });
  });
});
