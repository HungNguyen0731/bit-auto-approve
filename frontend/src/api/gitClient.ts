import type {
  GitBranch,
  GitBranchCreatePayload,
  GitBranchSwitchPayload,
  GitCommit,
  GitCommitPayload,
  GitDiffResponse,
  GitDiscardPayload,
  GitFetchPayload,
  GitPullPayload,
  GitPushPayload,
  GitScanReposResponse,
  GitStagePayload,
  GitStash,
  GitStashPopPayload,
  GitStashPushPayload,
  GitUnstagePayload,
  GitWorkingTreeStatus,
} from '../types/git';

import type {
  GitRemote,
  GitMergePayload,
  GitOperationResponse,
  GitRemoteWebUrlResponse,
} from '../../../shared/src/git-types';

const apiBase = () =>
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
    ? 'http://127.0.0.1:9999/api'
    : typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
    ? `${window.location.origin}/api`
    : 'http://127.0.0.1:3100/api';

export class GitApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = 'GitApiError';
  }
}

async function gitRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}${endpoint}`, { ...options, headers });
  } catch (error) {
    throw new GitApiError(
      'NETWORK_OFFLINE',
      error instanceof Error ? error.message : 'Cannot reach backend server.',
      0
    );
  }

  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    const error = json?.error && typeof json.error === 'object' ? json.error : null;
    throw new GitApiError(
      error?.code || json?.code || 'GIT_API_ERROR',
      error?.message || json?.message || (typeof json?.error === 'string' ? json.error : `Request failed with status ${response.status}`),
      response.status
    );
  }

  return (json?.data !== undefined ? json.data : json) as T;
}

const qs = (values: Record<string, string | number | boolean | undefined>) => {
  const result = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      result.set(key, String(value));
    }
  });
  return result.toString();
};

export const gitApi = {
  scanRepositories: async (rootPath: string, maxDepth: number = 4): Promise<GitScanReposResponse> => {
    return gitRequest<GitScanReposResponse>('/git/scan', {
      method: 'POST',
      body: JSON.stringify({ rootPath, maxDepth }),
    });
  },

  getRepositories: async (rootPath: string, maxDepth: number = 4): Promise<GitScanReposResponse> => {
    const query = qs({ rootPath, maxDepth });
    return gitRequest<GitScanReposResponse>(`/git/repositories?${query}`);
  },

  getStatus: async (repoPath: string): Promise<GitWorkingTreeStatus> => {
    const query = qs({ repoPath });
    return gitRequest<GitWorkingTreeStatus>(`/git/status?${query}`);
  },

  getCommits: async (
    repoPath: string,
    options?: { limit?: number; branch?: string; skip?: number }
  ): Promise<GitCommit[]> => {
    const query = qs({
      repoPath,
      limit: options?.limit,
      branch: options?.branch,
      skip: options?.skip,
    });
    return gitRequest<GitCommit[]>(`/git/commits?${query}`);
  },

  getDiff: async (
    repoPath: string,
    options?: {
      path?: string;
      staged?: boolean;
      commitHash?: string;
      compareCommitHash?: string;
    }
  ): Promise<GitDiffResponse> => {
    const query = qs({
      repoPath,
      path: options?.path,
      staged: options?.staged ? 'true' : undefined,
      commitHash: options?.commitHash,
      compareCommitHash: options?.compareCommitHash,
    });
    return gitRequest<GitDiffResponse>(`/git/diff?${query}`);
  },

  getBranches: async (repoPath: string): Promise<GitBranch[]> => {
    const query = qs({ repoPath });
    return gitRequest<GitBranch[]>(`/git/branches?${query}`);
  },

  getRemotes: async (repoPath: string): Promise<GitRemote[]> => {
    return gitRequest<GitRemote[]>(`/git/remotes?${qs({ repoPath })}`);
  },

  getRemoteWebUrl: async (repoPath: string): Promise<GitRemoteWebUrlResponse> => {
    return gitRequest<GitRemoteWebUrlResponse>(`/git/remote-web-url?${qs({ repoPath })}`);
  },

  merge: async (payload: GitMergePayload): Promise<GitOperationResponse> => {
    return gitRequest<GitOperationResponse>('/git/merge', { method: 'POST', body: JSON.stringify(payload) });
  },

  openInFinder: async (repoPath: string): Promise<GitOperationResponse> => {
    return gitRequest<GitOperationResponse>('/git/open-in-finder', { method: 'POST', body: JSON.stringify({ repoPath }) });
  },

  openTerminal: async (repoPath: string): Promise<GitOperationResponse> => {
    return gitRequest<GitOperationResponse>('/git/open-terminal', { method: 'POST', body: JSON.stringify({ repoPath }) });
  },

  createBranch: async (payload: GitBranchCreatePayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/branches/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  switchBranch: async (payload: GitBranchSwitchPayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/branches/switch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  stageFiles: async (payload: GitStagePayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/stage', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  unstageFiles: async (payload: GitUnstagePayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/unstage', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  discardChanges: async (payload: GitDiscardPayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/discard', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  commit: async (payload: GitCommitPayload): Promise<{ success: boolean; commitHash?: string; message?: string }> => {
    return gitRequest<{ success: boolean; commitHash?: string; message?: string }>('/git/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getStashes: async (repoPath: string): Promise<GitStash[]> => {
    const query = qs({ repoPath });
    return gitRequest<GitStash[]>(`/git/stash?${query}`);
  },

  pushStash: async (payload: GitStashPushPayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/stash/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  popStash: async (payload: GitStashPopPayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/stash/pop', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  fetchRepo: async (payload: GitFetchPayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/fetch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  pullRepo: async (payload: GitPullPayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/pull', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  pushRepo: async (payload: GitPushPayload): Promise<{ success: boolean; message?: string }> => {
    return gitRequest<{ success: boolean; message?: string }>('/git/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
