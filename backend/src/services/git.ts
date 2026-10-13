import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import type {
  GitBranch,
  GitCommit,
  GitCommitRef,
  GitDiffResponse,
  GitFileStatusType,
  GitRepositoryInfo,
  GitRemote,
  GitMergePayload,
  GitRemoteWebUrlResponse,
  GitOperationResponse,
  GitScanReposResponse,
  GitStash,
  GitStatusFile,
  GitWorkingTreeStatus,
} from '@bitbucket-pr-approver/shared';
import { parseGitDiff } from './git-diff-parser.js';

const execFileAsync = promisify(execFile);

export class GitService {
  /**
   * Executes a git command safely in a specified directory with environment safeguards
   */
  async executeGit(
    args: string[],
    cwd: string,
    options: { timeout?: number; maxBuffer?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd,
        maxBuffer: options.maxBuffer || 25 * 1024 * 1024,
        timeout: options.timeout || 30000,
        env: {
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          GIT_TERMINAL_PROMPT: '0',
        },
      });
      return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (err: any) {
      const message = err.stderr?.toString() || err.stdout?.toString() || err.message;
      const error = new Error(`Git command failed: git ${args.join(' ')}\n${message}`);
      (error as any).code = 'GIT_COMMAND_ERROR';
      (error as any).exitCode = err.code;
      (error as any).stderr = err.stderr?.toString();
      (error as any).stdout = err.stdout?.toString();
      throw error;
    }
  }

  /**
   * Checks whether the directory is a valid git repository
   */
  async isGitRepository(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(dirPath);
      if (!stat.isDirectory()) return false;
      const gitDir = path.join(dirPath, '.git');
      if (fs.existsSync(gitDir)) return true;

      const { stdout } = await this.executeGit(['rev-parse', '--is-inside-work-tree'], dirPath);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Recursively scans a root directory for git repositories up to maxDepth
   */
  async scanRepositories(rootPath: string, maxDepth: number = 4): Promise<GitScanReposResponse> {
    const resolvedRoot = path.resolve(rootPath);
    if (!fs.existsSync(resolvedRoot)) {
      throw new Error(`Directory does not exist: ${resolvedRoot}`);
    }

    const stat = await fs.promises.stat(resolvedRoot);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedRoot}`);
    }

    const discoveredRepoPaths: string[] = [];
    const ignoredDirs = new Set([
      'node_modules',
      '.npm',
      '.yarn',
      'dist',
      'build',
      '.cache',
      '.turbo',
      '.next',
      '.git',
      '.vscode',
      '.idea',
    ]);

    const traverse = async (currentDir: string, currentDepth: number) => {
      if (currentDepth > maxDepth) return;
      try {
        const gitPath = path.join(currentDir, '.git');
        if (fs.existsSync(gitPath)) {
          discoveredRepoPaths.push(currentDir);
          // Do not traverse deeper inside a discovered git repository
          return;
        }

        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !ignoredDirs.has(entry.name) && !entry.name.startsWith('.')) {
            await traverse(path.join(currentDir, entry.name), currentDepth + 1);
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    // If rootPath itself is a repository, include it
    if (fs.existsSync(path.join(resolvedRoot, '.git'))) {
      discoveredRepoPaths.push(resolvedRoot);
    } else {
      await traverse(resolvedRoot, 1);
    }

    // Inspect each repository in parallel with bounded concurrency
    const repositories: GitRepositoryInfo[] = [];
    for (const repoPath of discoveredRepoPaths) {
      try {
        const repoInfo = await this.inspectRepository(repoPath);
        repositories.push(repoInfo);
      } catch {
        // Continue if single repo inspection fails
      }
    }

    repositories.sort((a, b) => a.name.localeCompare(b.name));

    return {
      rootPath: resolvedRoot,
      repositories,
    };
  }

  /**
   * Inspects a single repository for branch, status, ahead/behind, and latest commit
   */
  async inspectRepository(repoPath: string): Promise<GitRepositoryInfo> {
    const status = await this.getWorkingTreeStatus(repoPath);
    const repoName = path.basename(repoPath);

    let lastCommitHash: string | undefined;
    let lastCommitMessage: string | undefined;
    let lastCommitDate: string | undefined;
    let lastCommitAuthor: string | undefined;

    try {
      const { stdout } = await this.executeGit(['log', '-1', '--format=%H%x00%s%x00%aI%x00%an'], repoPath);
      if (stdout.trim()) {
        const parts = stdout.trim().split('\0');
        lastCommitHash = parts[0] || undefined;
        lastCommitMessage = parts[1] || undefined;
        lastCommitDate = parts[2] || undefined;
        lastCommitAuthor = parts[3] || undefined;
      }
    } catch {
      // Empty repository with no commits yet
    }

    return {
      name: repoName,
      path: repoPath,
      currentBranch: status.branch,
      isClean: status.isClean,
      stagedCount: status.staged.length,
      unstagedCount: status.unstaged.length,
      untrackedCount: status.untracked.length,
      ahead: status.ahead,
      behind: status.behind,
      lastCommitHash,
      lastCommitMessage,
      lastCommitDate,
      lastCommitAuthor,
    };
  }

  /**
   * Extracts working tree status (staged, unstaged, untracked, ahead/behind)
   */
  async getWorkingTreeStatus(repoPath: string): Promise<GitWorkingTreeStatus> {
    const { stdout } = await this.executeGit(['status', '--porcelain=v1', '-uall', '-b'], repoPath);
    const lines = stdout.split('\n');

    let branch = 'HEAD';
    let upstream: string | undefined = undefined;
    let ahead = 0;
    let behind = 0;
    const staged: GitStatusFile[] = [];
    const unstaged: GitStatusFile[] = [];
    const untracked: GitStatusFile[] = [];

    for (const rawLine of lines) {
      if (!rawLine) continue;

      if (rawLine.startsWith('## ')) {
        const branchLine = rawLine.slice(3).trim();
        // Matching: ## branch...upstream [ahead X, behind Y]
        // or ## No commits yet on main
        // or ## HEAD (no branch)
        if (branchLine.startsWith('No commits yet on ')) {
          branch = branchLine.slice('No commits yet on '.length).trim();
          continue;
        }
        if (branchLine.startsWith('Initial commit on ')) {
          branch = branchLine.slice('Initial commit on '.length).trim();
          continue;
        }

        const match = branchLine.match(/^([^\s.]+)(?:\.\.\.([^\s\[]+))?(?:\s+\[(?:ahead\s+(\d+))?(?:,\s*)?(?:behind\s+(\d+))?\])?/);
        if (match) {
          branch = match[1];
          if (match[2]) upstream = match[2];
          if (match[3]) ahead = parseInt(match[3], 10);
          if (match[4]) behind = parseInt(match[4], 10);
        } else {
          branch = branchLine;
        }
        continue;
      }

      const x = rawLine[0];
      const y = rawLine[1];
      const filePart = rawLine.slice(3).trim();

      let filePath = filePart;
      let oldPath: string | undefined = undefined;
      if (filePart.includes(' -> ')) {
        const parts = filePart.split(' -> ');
        oldPath = parts[0];
        filePath = parts[1];
      }

      if (x === '?' && y === '?') {
        untracked.push({
          path: filePath,
          status: 'untracked',
          staged: false,
        });
        continue;
      }

      if (x === '!' && y === '!') {
        continue;
      }

      // Check conflict markers
      const isConflict =
        x === 'U' ||
        y === 'U' ||
        (x === 'A' && y === 'A') ||
        (x === 'D' && y === 'D');

      if (isConflict) {
        unstaged.push({
          path: filePath,
          oldPath,
          status: 'conflict',
          staged: false,
        });
        continue;
      }

      // Staged changes
      if (x !== ' ' && x !== '?') {
        let status: GitFileStatusType = 'modified';
        if (x === 'A') status = 'added';
        else if (x === 'D') status = 'deleted';
        else if (x === 'R') status = 'renamed';
        else if (x === 'C') status = 'copied';
        else if (x === 'M') status = 'modified';

        staged.push({
          path: filePath,
          oldPath,
          status,
          staged: true,
        });
      }

      // Unstaged changes
      if (y !== ' ' && y !== '?') {
        let status: GitFileStatusType = 'modified';
        if (y === 'M') status = 'modified';
        else if (y === 'D') status = 'deleted';

        unstaged.push({
          path: filePath,
          oldPath,
          status,
          staged: false,
        });
      }
    }

    const isClean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;

    return {
      branch,
      upstream,
      ahead,
      behind,
      isClean,
      staged,
      unstaged,
      untracked,
    };
  }

  /**
   * Extracts topological commit history with parents, authors, dates, and branch/tag refs
   * Designed for Sourcetree-like DAG visual rendering
   */
  async getCommitHistory(
    repoPath: string,
    options: { limit?: number; branch?: string; skip?: number } = {}
  ): Promise<GitCommit[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const args = [
      'log',
      '--topo-order',
      '--decorate=full',
      '--parents',
      `-n`,
      String(limit),
      `--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%D`,
    ];

    if (options.skip && options.skip > 0) {
      args.push(`--skip=${options.skip}`);
    }

    if (options.branch?.trim()) {
      args.push(options.branch.trim());
    } else {
      args.push('--all');
    }

    let stdout = '';
    try {
      const res = await this.executeGit(args, repoPath);
      stdout = res.stdout;
    } catch (err: any) {
      const msg = err.message || '';
      if (
        msg.includes('does not have any commits') ||
        msg.includes('unknown revision') ||
        msg.includes('bad default revision') ||
        msg.includes('fatal: your current branch')
      ) {
        return [];
      }
      throw err;
    }

    const commits: GitCommit[] = [];
    const records = stdout.split('\n').filter(Boolean);

    for (const record of records) {
      const [hash, parentsStr, authorName, authorEmail, date, message, refStr] = record.split('\0');
      if (!hash) continue;

      const parents = parentsStr ? parentsStr.trim().split(/\s+/).filter(Boolean) : [];
      const refs: GitCommitRef[] = [];

      if (refStr && refStr.trim()) {
        const rawRefs = refStr.split(',').map((r) => r.trim()).filter(Boolean);
        for (const raw of rawRefs) {
          if (raw.startsWith('HEAD -> refs/heads/')) {
            const name = raw.slice('HEAD -> refs/heads/'.length);
            refs.push({ name: 'HEAD', type: 'head', fullName: raw });
            refs.push({ name, type: 'branch', fullName: `refs/heads/${name}` });
          } else if (raw.startsWith('HEAD -> ')) {
            const name = raw.slice('HEAD -> '.length);
            refs.push({ name: 'HEAD', type: 'head', fullName: raw });
            refs.push({ name, type: 'branch', fullName: name });
          } else if (raw === 'HEAD') {
            refs.push({ name: 'HEAD', type: 'head', fullName: 'HEAD' });
          } else if (raw.startsWith('refs/heads/')) {
            const name = raw.slice('refs/heads/'.length);
            refs.push({ name, type: 'branch', fullName: raw });
          } else if (raw.startsWith('refs/remotes/')) {
            const name = raw.slice('refs/remotes/'.length);
            refs.push({ name, type: 'remote-branch', fullName: raw });
          } else if (raw.startsWith('tag: refs/tags/')) {
            const name = raw.slice('tag: refs/tags/'.length);
            refs.push({ name, type: 'tag', fullName: raw });
          } else if (raw.startsWith('tag: ')) {
            const name = raw.slice('tag: '.length);
            refs.push({ name, type: 'tag', fullName: raw });
          } else if (raw.startsWith('refs/tags/')) {
            const name = raw.slice('refs/tags/'.length);
            refs.push({ name, type: 'tag', fullName: raw });
          } else {
            refs.push({ name: raw, type: 'branch', fullName: raw });
          }
        }
      }

      commits.push({
        hash,
        shortHash: hash.slice(0, 8),
        parents,
        authorName: authorName || '',
        authorEmail: authorEmail || '',
        date: date || new Date().toISOString(),
        message: message || '',
        refs,
      });
    }

    return commits;
  }

  /**
   * Generates diffs for working tree or specific commits
   */
  async getDiff(
    repoPath: string,
    options: {
      path?: string;
      staged?: boolean;
      commitHash?: string;
      compareCommitHash?: string;
    } = {}
  ): Promise<GitDiffResponse> {
    let rawDiff = '';

    if (options.commitHash) {
      if (options.compareCommitHash) {
        const args = ['diff', options.compareCommitHash, options.commitHash];
        if (options.path) {
          args.push('--', options.path);
        }
        const { stdout } = await this.executeGit(args, repoPath);
        rawDiff = stdout;
      } else {
        const args = ['show', '--patch', '--format=', options.commitHash];
        if (options.path) {
          args.push('--', options.path);
        }
        const { stdout } = await this.executeGit(args, repoPath);
        rawDiff = stdout;
      }
    } else {
      // Working tree diff
      const args = ['diff'];
      if (options.staged) {
        args.push('--cached');
      }
      if (options.path) {
        args.push('--', options.path);
      }

      try {
        const { stdout } = await this.executeGit(args, repoPath);
        rawDiff = stdout;
      } catch {
        rawDiff = '';
      }

      // If diff is empty and path is untracked file, create addition diff
      if (!rawDiff && options.path && !options.staged) {
        const fullFilePath = path.resolve(repoPath, options.path);
        if (fs.existsSync(fullFilePath)) {
          try {
            await this.executeGit(['diff', '--no-index', '--', '/dev/null', options.path], repoPath);
          } catch (err: any) {
            // git diff --no-index outputs diff and exits with code 1
            if (err.stdout) {
              rawDiff = err.stdout;
            }
          }
        }
      }
    }

    const files = parseGitDiff(rawDiff);
    return {
      files,
      rawDiff,
    };
  }

  /**
   * Lists all local and remote branches
   */
  async getBranches(repoPath: string): Promise<GitBranch[]> {
    const { stdout } = await this.executeGit(
      ['branch', '-a', '--format=%(refname)|::|%(objectname)|::|%(upstream:short)|::|%(HEAD)'],
      repoPath
    );
    const branches: GitBranch[] = [];
    const lines = stdout.split('\n').filter(Boolean);

    for (const line of lines) {
      const [refname, commitHash, upstream, headMarker] = line.split('|::|');
      if (!refname) continue;

      const isRemote = refname.startsWith('refs/remotes/');
      let name = refname;
      if (refname.startsWith('refs/heads/')) {
        name = refname.slice('refs/heads/'.length);
      } else if (refname.startsWith('refs/remotes/')) {
        name = refname.slice('refs/remotes/'.length);
      }

      if (name.endsWith('/HEAD')) continue;

      branches.push({
        name,
        current: headMarker?.trim() === '*',
        commitHash: commitHash || '',
        upstream: upstream || undefined,
        isRemote,
      });
    }

    return branches;
  }

  async getRemotes(repoPath: string): Promise<GitRemote[]> {
    const { stdout } = await this.executeGit(['remote'], repoPath);
    const remotes: GitRemote[] = [];
    for (const name of stdout.split('\n').filter(Boolean)) {
      const fetch = await this.executeGit(['remote', 'get-url', '--', name], repoPath);
      const push = await this.executeGit(['remote', 'get-url', '--push', '--', name], repoPath);
      remotes.push({ name, url: fetch.stdout.trim(), pushUrl: push.stdout.trim() });
    }
    return remotes;
  }

  async merge(repoPath: string, options: Omit<GitMergePayload, 'repoPath'>): Promise<GitOperationResponse> {
    const branch = typeof options.branch === 'string' ? options.branch.trim() : '';
    if (!branch || branch.startsWith('-') || /[\0\r\n]/.test(branch)) {
      throw new Error('A valid merge branch is required');
    }
    const args = ['merge', '--no-edit'];
    if (options.noFf) args.push('--no-ff');
    if (options.message?.trim()) args.push('-m', options.message.trim());
    args.push('--', branch);
    const { stdout, stderr } = await this.executeGit(args, repoPath);
    return { success: true, output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') };
  }

  async getRemoteWebUrl(repoPath: string): Promise<GitRemoteWebUrlResponse> {
    const origin = (await this.getRemotes(repoPath)).find((remote) => remote.name === 'origin');
    if (!origin) throw new Error('No origin remote is configured');
    let remote = origin.url;
    const scp = remote.match(/^(?:[^@/:]+@)?([^/:]+):(.+)$/);
    if (!remote.includes('://') && scp) remote = `https://${scp[1]}/${scp[2]}`;
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new Error('Origin does not have a supported remote web URL');
    }
    if (!['https:', 'http:', 'ssh:'].includes(url.protocol) || !['github.com', 'bitbucket.org'].includes(url.hostname.toLowerCase())) {
      throw new Error('Origin does not have a supported GitHub or Bitbucket web URL');
    }
    if (url.protocol === 'ssh:') {
      url.protocol = 'https:';
      // WHATWG URL does not change non-special ssh URLs to special https URLs.
      url = new URL(`https://${url.hostname}${url.pathname}`);
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
    if (!url.pathname || url.pathname === '/') throw new Error('Origin does not have a supported repository web URL');
    return { url: url.toString().replace(/\/$/, '') };
  }

  private async openRepository(repoPath: string, terminal: boolean): Promise<GitOperationResponse> {
    const resolved = path.resolve(repoPath);
    if (!(await this.isGitRepository(resolved))) throw new Error('Path is not a Git repository');
    if (process.platform !== 'darwin') throw new Error('Desktop integration is only supported on macOS');
    await execFileAsync('open', terminal ? ['-a', 'Terminal', resolved] : [resolved], {
      cwd: resolved,
      timeout: 10000,
    });
    return { success: true };
  }

  async openInFinder(repoPath: string): Promise<GitOperationResponse> {
    return this.openRepository(repoPath, false);
  }

  async openTerminal(repoPath: string): Promise<GitOperationResponse> {
    return this.openRepository(repoPath, true);
  }

  /**
   * Stages specified files or all working tree modifications
   */
  async stage(
    repoPath: string,
    paths?: string[],
    all?: boolean
  ): Promise<{ success: boolean; stagedPaths: string[] }> {
    if (all || !paths || paths.length === 0) {
      await this.executeGit(['add', '-A'], repoPath);
      return { success: true, stagedPaths: ['*'] };
    }
    await this.executeGit(['add', '--', ...paths], repoPath);
    return { success: true, stagedPaths: paths };
  }

  /**
   * Unstages specified files or all staged modifications
   */
  async unstage(
    repoPath: string,
    paths?: string[],
    all?: boolean
  ): Promise<{ success: boolean; unstagedPaths: string[] }> {
    if (all || !paths || paths.length === 0) {
      await this.executeGit(['reset', 'HEAD'], repoPath);
      return { success: true, unstagedPaths: ['*'] };
    }
    await this.executeGit(['reset', 'HEAD', '--', ...paths], repoPath);
    return { success: true, unstagedPaths: paths };
  }

  /**
   * Discards uncommitted changes for specified files or all working tree
   */
  async discard(
    repoPath: string,
    paths?: string[],
    all?: boolean
  ): Promise<{ success: boolean; discardedPaths: string[] }> {
    const status = await this.getWorkingTreeStatus(repoPath);
    const targetPaths =
      all || !paths || paths.length === 0
        ? [...status.unstaged.map((f) => f.path), ...status.untracked.map((f) => f.path)]
        : paths;

    const untrackedSet = new Set(status.untracked.map((f) => f.path));
    const toClean: string[] = [];
    const toRestore: string[] = [];

    for (const p of targetPaths) {
      if (untrackedSet.has(p)) {
        toClean.push(p);
      } else {
        toRestore.push(p);
      }
    }

    if (toRestore.length > 0) {
      try {
        await this.executeGit(['restore', '--', ...toRestore], repoPath);
      } catch {
        await this.executeGit(['checkout', '--', ...toRestore], repoPath);
      }
    }

    for (const p of toClean) {
      const fullPath = path.resolve(repoPath, p);
      try {
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      } catch {
        // Best effort clean
      }
    }

    return { success: true, discardedPaths: targetPaths };
  }

  /**
   * Creates a new git commit with message and optional amend
   */
  async commit(
    repoPath: string,
    message: string,
    amend?: boolean
  ): Promise<{ success: boolean; commitHash: string }> {
    if (!message || !message.trim()) {
      throw new Error('Commit message cannot be empty');
    }

    const args = ['commit', '-m', message.trim()];
    if (amend) {
      args.push('--amend');
    }

    await this.executeGit(args, repoPath);
    const { stdout } = await this.executeGit(['rev-parse', 'HEAD'], repoPath);
    return { success: true, commitHash: stdout.trim() };
  }

  /**
   * Switches to an existing branch or creates a new one
   */
  async switchBranch(
    repoPath: string,
    branchName: string,
    createNew?: boolean
  ): Promise<{ success: boolean; currentBranch: string }> {
    const trimmed = branchName.trim();
    if (!trimmed) throw new Error('Branch name cannot be empty');

    const args = createNew ? ['checkout', '-b', trimmed] : ['checkout', trimmed];
    await this.executeGit(args, repoPath);
    return { success: true, currentBranch: trimmed };
  }

  /**
   * Creates a new branch at startPoint and optionally checks it out
   */
  async createBranch(
    repoPath: string,
    branchName: string,
    startPoint?: string,
    checkout?: boolean
  ): Promise<{ success: boolean; branch: string }> {
    const trimmed = branchName.trim();
    if (!trimmed) throw new Error('Branch name cannot be empty');

    const args = checkout ? ['checkout', '-b', trimmed] : ['branch', trimmed];
    if (startPoint?.trim()) {
      args.push(startPoint.trim());
    }

    await this.executeGit(args, repoPath);
    return { success: true, branch: trimmed };
  }

  /**
   * Lists stashes in repository
   */
  async getStashes(repoPath: string): Promise<GitStash[]> {
    try {
      const { stdout } = await this.executeGit(['stash', 'list', '--format=%gd|::|%H|::|%aI|::|%gs'], repoPath);
      const stashes: GitStash[] = [];
      const lines = stdout.split('\n').filter(Boolean);

      for (const line of lines) {
        const [ref, hash, date, message] = line.split('|::|');
        if (!ref) continue;

        const match = ref.match(/stash@\{(\d+)\}/);
        const index = match ? parseInt(match[1], 10) : 0;
        stashes.push({
          index,
          hash: hash || '',
          date: date || '',
          message: message || ref,
        });
      }

      return stashes;
    } catch {
      return [];
    }
  }

  /**
   * Pushes current changes to stash
   */
  async stashPush(
    repoPath: string,
    message?: string,
    includeUntracked?: boolean
  ): Promise<{ success: boolean; output: string }> {
    const args = ['stash', 'push'];
    if (includeUntracked) {
      args.push('-u');
    }
    if (message?.trim()) {
      args.push('-m', message.trim());
    }

    const { stdout, stderr } = await this.executeGit(args, repoPath);
    return { success: true, output: (stdout || stderr).trim() };
  }

  /**
   * Pops stash by index
   */
  async stashPop(repoPath: string, index?: number): Promise<{ success: boolean; output: string }> {
    const args = ['stash', 'pop'];
    if (index !== undefined) {
      args.push(`stash@{${index}}`);
    }

    const { stdout, stderr } = await this.executeGit(args, repoPath);
    return { success: true, output: (stdout || stderr).trim() };
  }

  /**
   * Fetches updates from remote repository
   */
  async fetch(
    repoPath: string,
    remote?: string,
    prune?: boolean
  ): Promise<{ success: boolean; output: string }> {
    const args = ['fetch'];
    if (remote?.trim()) {
      args.push(remote.trim());
    }
    if (prune) {
      args.push('--prune');
    }

    const { stdout, stderr } = await this.executeGit(args, repoPath);
    return { success: true, output: (stdout || stderr).trim() };
  }

  /**
   * Pulls commits from remote repository
   */
  async pull(
    repoPath: string,
    remote?: string,
    branch?: string,
    rebase?: boolean
  ): Promise<{ success: boolean; output: string }> {
    const args = ['pull'];
    if (rebase) {
      args.push('--rebase');
    }
    if (remote?.trim()) {
      args.push(remote.trim());
      if (branch?.trim()) {
        args.push(branch.trim());
      }
    }

    const { stdout, stderr } = await this.executeGit(args, repoPath);
    return { success: true, output: (stdout || stderr).trim() };
  }

  /**
   * Pushes local commits to remote repository
   */
  async push(
    repoPath: string,
    remote?: string,
    branch?: string,
    setUpstream?: boolean,
    force?: boolean
  ): Promise<{ success: boolean; output: string }> {
    const args = ['push'];
    if (setUpstream) {
      args.push('-u');
    }
    if (force) {
      args.push('--force-with-lease');
    }
    if (remote?.trim()) {
      args.push(remote.trim());
      if (branch?.trim()) {
        args.push(branch.trim());
      }
    }

    const { stdout, stderr } = await this.executeGit(args, repoPath);
    return { success: true, output: (stdout || stderr).trim() };
  }
}
