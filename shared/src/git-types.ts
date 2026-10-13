/**
 * Shared Type Definitions for Git Engine & Management Module
 */

export type GitRefType = 'branch' | 'remote-branch' | 'tag' | 'head';

export interface GitCommitRef {
  name: string;
  type: GitRefType;
  fullName: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: string; // ISO 8601
  message: string;
  refs: GitCommitRef[];
}

export type GitFileStatusType =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflict';

export interface GitStatusFile {
  path: string;
  oldPath?: string;
  status: GitFileStatusType;
  staged: boolean;
}

export interface GitWorkingTreeStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  isClean: boolean;
  staged: GitStatusFile[];
  unstaged: GitStatusFile[];
  untracked: GitStatusFile[];
}

export interface GitRepositoryInfo {
  name: string;
  path: string;
  currentBranch: string;
  isClean: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  ahead: number;
  behind: number;
  lastCommitHash?: string;
  lastCommitMessage?: string;
  lastCommitDate?: string;
  lastCommitAuthor?: string;
}

export interface GitScanReposRequest {
  rootPath: string;
  maxDepth?: number;
}

export interface GitScanReposResponse {
  rootPath: string;
  repositories: GitRepositoryInfo[];
}

export interface GitDiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface GitDiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitDiffLine[];
}

export interface GitFileDiff {
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  isBinary: boolean;
  hunks: GitDiffHunk[];
  additions: number;
  deletions: number;
  rawDiff: string;
}

export interface GitDiffResponse {
  files: GitFileDiff[];
  rawDiff: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  commitHash: string;
  upstream?: string;
  isRemote: boolean;
}

export interface GitRemote {
  name: string;
  url: string;
  pushUrl: string;
}

export interface GitMergePayload {
  repoPath: string;
  branch: string;
  noFf?: boolean;
  message?: string;
}

export interface GitRemoteWebUrlResponse {
  url: string;
}

export interface GitOpenPayload {
  repoPath: string;
}

export interface GitOperationResponse {
  success: boolean;
  output?: string;
}

export interface GitStash {
  index: number;
  message: string;
  date: string;
  hash: string;
}

export interface GitStagePayload {
  repoPath: string;
  paths?: string[];
  all?: boolean;
}

export interface GitUnstagePayload {
  repoPath: string;
  paths?: string[];
  all?: boolean;
}

export interface GitDiscardPayload {
  repoPath: string;
  paths?: string[];
  all?: boolean;
}

export interface GitCommitPayload {
  repoPath: string;
  message: string;
  amend?: boolean;
}

export interface GitBranchSwitchPayload {
  repoPath: string;
  branchName: string;
  createNew?: boolean;
}

export interface GitBranchCreatePayload {
  repoPath: string;
  branchName: string;
  startPoint?: string;
  checkout?: boolean;
}

export interface GitStashPushPayload {
  repoPath: string;
  message?: string;
  includeUntracked?: boolean;
}

export interface GitStashPopPayload {
  repoPath: string;
  index?: number;
}

export interface GitFetchPayload {
  repoPath: string;
  remote?: string;
  prune?: boolean;
}

export interface GitPullPayload {
  repoPath: string;
  remote?: string;
  branch?: string;
  rebase?: boolean;
}

export interface GitPushPayload {
  repoPath: string;
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  force?: boolean;
}
