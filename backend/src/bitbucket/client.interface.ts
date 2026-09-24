import type {
  BitbucketUserProfile,
  RepositoryInfo,
  RepositoryRef,
  PullRequest,
  BitbucketRepositoryMeta,
  BitbucketBranchMeta,
  BitbucketUserMeta,
  BitbucketWorkspaceMeta,
} from '@bitbucket-pr-approver/shared';

export interface IBitbucketClient {
  testConnection(): Promise<BitbucketUserProfile>;
  getCurrentUser(): Promise<BitbucketUserProfile>;
  listWorkspaces(): Promise<BitbucketWorkspaceMeta[]>;
  listRepositories(projectOrWorkspace?: string): Promise<RepositoryInfo[]>;
  listOpenPullRequests(repo: RepositoryRef): Promise<PullRequest[]>;
  getPullRequest(repo: RepositoryRef, prId: number): Promise<PullRequest>;
  approvePullRequest(repo: RepositoryRef, prId: number): Promise<{ success: boolean; message: string }>;
  searchRepositories(options?: { query?: string; project?: string; limit?: number }): Promise<BitbucketRepositoryMeta[]>;
  searchBranches(options: { repository: string; query?: string; limit?: number }): Promise<BitbucketBranchMeta[]>;
  searchUsers(options?: { workspace?: string; query?: string; limit?: number }): Promise<BitbucketUserMeta[]>;
  searchPullRequests?(options: { repository: string; state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'; query?: string; limit?: number }): Promise<PullRequest[]>;
}

