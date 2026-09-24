import { Agent, ProxyAgent, fetch, type Dispatcher } from 'undici';
import type {
  BitbucketConnectionConfig,
  BitbucketUserProfile,
  PullRequest,
  PullRequestReviewer,
  RepositoryInfo,
  RepositoryRef,
  BitbucketRepositoryMeta,
  BitbucketBranchMeta,
  BitbucketUserMeta,
  BitbucketWorkspaceMeta,
} from '@bitbucket-pr-approver/shared';
import type { IBitbucketClient } from './client.interface.js';
import { BitbucketError, classifyNetworkError } from './errors.js';

export class BitbucketCloudClient implements IBitbucketClient {
  private readonly baseUrl: string;
  private readonly config: BitbucketConnectionConfig;
  private readonly dispatcher?: Dispatcher;

  constructor(config: BitbucketConnectionConfig) {
    this.config = config;
    // Runtime is Cloud-only: legacy persisted Server/Data Center URLs are never contacted.
    this.baseUrl = 'https://api.bitbucket.org/2.0';

    if (config.proxyUrl) {
      this.dispatcher = new ProxyAgent(config.proxyUrl);
    } else if (config.skipSslVerification) {
      this.dispatcher = new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      });
    }
  }

  private getAuthHeader(): string {
    const { authType, token, username } = this.config;
    if (authType === 'basic' && username && token) {
      const creds = Buffer.from(`${username}:${token}`).toString('base64');
      return `Basic ${creds}`;
    }
    if (token) {
      return `Bearer ${token}`;
    }
    throw new BitbucketError('No token or credentials configured for Bitbucket Cloud', 'AUTH_INVALID_CREDENTIALS', 401);
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const timeout = this.config.timeoutMs || 15000;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.getAuthHeader(),
      ...options.headers,
    };

    let bodyStr: string | undefined;
    if (options.body) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: bodyStr,
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(timeout),
      });

      if (response.status === 401) {
        throw new BitbucketError(
          'Authentication failed on Bitbucket Cloud (HTTP 401). Invalid username or App Password.',
          'AUTH_INVALID_TOKEN',
          401
        );
      }

      if (response.status === 403) {
        const responseBody = await response.text().catch(() => '');
        const normalizedBody = responseBody.toLowerCase();
        const isIpAllowlist =
          normalizedBody.includes('ip allowlist') ||
          normalizedBody.includes('ip whitelist') ||
          normalizedBody.includes('ip address') ||
          normalizedBody.includes('access from this ip');
        throw new BitbucketError(
          isIpAllowlist
            ? 'Bitbucket Cloud denied this workstation IP (HTTP 403). Connect the corporate VPN or allowlist this egress IP.'
            : 'Access denied on Bitbucket Cloud (HTTP 403). Insufficient scopes on App Password.',
          isIpAllowlist ? 'IP_ALLOWLIST' : 'INSUFFICIENT_SCOPES',
          403,
          { responseBody }
        );
      }

      if (response.status === 404) {
        throw new BitbucketError(
          `Resource not found on Bitbucket Cloud (HTTP 404): ${url}`,
          'WORKSPACE_NOT_FOUND',
          404
        );
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 30;
        throw new BitbucketError(
          `Bitbucket Cloud rate limit exceeded. Retry after ${retryAfter}s.`,
          'RATE_LIMITED',
          429,
          { rateLimitReset: retryAfter }
        );
      }

      if (!response.ok) {
        let errBody: string = '';
        try {
          errBody = await response.text();
        } catch {
          // ignore
        }
        throw new BitbucketError(
          `Bitbucket Cloud API error: ${response.status} ${response.statusText}${errBody ? ` - ${errBody}` : ''}`,
          'BITBUCKET_UNREACHABLE',
          response.status,
          { responseBody: errBody }
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    } catch (err: unknown) {
      throw classifyNetworkError(err, this.baseUrl);
    }
  }

  private async paginatedValues<T>(path: string, limit: number): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = path;
    while (next && items.length < limit) {
      const page: { values?: T[]; next?: string } = await this.request(next);
      items.push(...(page.values || []));
      next = page.next;
    }
    return items.slice(0, limit);
  }

  private async resolveWorkspace(explicitWorkspace?: string): Promise<string> {
    const configuredWorkspace = explicitWorkspace?.trim() || this.config.workspace?.trim();
    if (configuredWorkspace) {
      return configuredWorkspace;
    }

    const discoveredWorkspace = (await this.listWorkspaces())[0]?.slug;
    if (discoveredWorkspace) {
      return discoveredWorkspace;
    }

    throw new BitbucketError(
      'No accessible Bitbucket Cloud workspace was found for the authenticated account.',
      'WORKSPACE_NOT_FOUND',
      404
    );
  }


  async testConnection(): Promise<BitbucketUserProfile> {
    return this.getCurrentUser();
  }

  async getCurrentUser(): Promise<BitbucketUserProfile> {
    const startTime = performance.now();
    const data = await this.request<any>('/user');
    const username = data.nickname || data.username || data.account_id || this.config.username || 'cloud-user';

    // Onboarding is unlocked only after both real Cloud calls succeed.
    const workspaces = await this.listWorkspaces();

    const latencyMs = Math.round(performance.now() - startTime);

    return {
      username,
      displayName: data.display_name || username,
      avatarUrl: data.links?.avatar?.href,
      serverType: 'cloud',
      isAvailable: true,
      vpnConnected: true,
      verifiedAt: new Date().toISOString(),
      serverEdition: 'Bitbucket Cloud (REST v2.0)',
      latencyMs,
      accountId: data.account_id,
      uuid: data.uuid,
      selectedWorkspace: this.config.workspace || workspaces[0]?.slug,
      workspaces,
    };
  }

  async listWorkspaces(): Promise<BitbucketWorkspaceMeta[]> {
    // Bitbucket Cloud retired the former top-level /workspaces collection.
    // The authenticated user's accessible workspaces are now exposed here as
    // workspace-membership records, so normalize the nested workspace object.
    const items = await this.paginatedValues<any>('/user/workspaces?pagelen=100', 1000);
    return items
      .map((membership) => membership.workspace || membership)
      .filter((workspace) => Boolean(workspace?.slug && workspace?.uuid))
      .map((workspace) => ({
        slug: workspace.slug,
        name: workspace.name || workspace.slug,
        uuid: workspace.uuid,
        avatarUrl: workspace.links?.avatar?.href,
        isPersonal: Boolean(workspace.is_personal),
      }));
  }

  async listRepositories(projectOrWorkspace?: string): Promise<RepositoryInfo[]> {
    const workspace = await this.resolveWorkspace(projectOrWorkspace);

    const path = `/repositories/${encodeURIComponent(workspace)}?pagelen=100&sort=-updated_on`;
    const res = await this.request<{ values: any[] }>(path);
    const repos = res.values || [];

    return repos.map((r) => ({
      projectOrWorkspace: r.workspace?.slug || workspace,
      slug: r.slug,
      name: r.name,
      description: r.description,
      isPrivate: Boolean(r.is_private),
      cloneUrl: r.links?.clone?.find((c: any) => c.name === 'https')?.href,
    }));
  }

  async listOpenPullRequests(repo: RepositoryRef): Promise<PullRequest[]> {
    const path = `/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests?state=OPEN&pagelen=50`;
    const res = await this.request<{ values: any[] }>(path);
    const items = res.values || [];

    return items.map((item) => this.normalizeCloudPr(item, repo));
  }

  async getPullRequest(repo: RepositoryRef, prId: number): Promise<PullRequest> {
    const path = `/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests/${prId}`;
    const item = await this.request<any>(path);
    return this.normalizeCloudPr(item, repo);
  }

  async approvePullRequest(repo: RepositoryRef, prId: number): Promise<{ success: boolean; message: string }> {
    const path = `/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests/${prId}/approve`;
    const res = await this.request<any>(path, { method: 'POST', body: {} });
    const status = res?.status || 'APPROVED';
    return {
      success: true,
      message: `Successfully approved PR #${prId} in ${repo.projectOrWorkspace}/${repo.slug} (Status: ${status})`,
    };
  }

  async searchRepositories(options?: { query?: string; project?: string; limit?: number }): Promise<BitbucketRepositoryMeta[]> {
    const workspace = await this.resolveWorkspace(options?.project);

    const limit = Math.min(Math.max(options?.limit || 25, 1), 100);
    let path = `/repositories/${encodeURIComponent(workspace)}?pagelen=${limit}&sort=-updated_on`;
    if (options?.query?.trim()) {
      path += `&q=${encodeURIComponent(`name~"${options.query.trim()}"`)}`;
    }

    const repos = await this.paginatedValues<any>(path, limit);

    return repos.map((r) => ({
      slug: r.slug,
      name: r.name,
      projectKey: r.project?.key || r.workspace?.slug || workspace,
      projectName: r.project?.name || r.workspace?.name || workspace,
      workspace: r.workspace?.slug || workspace,
      uuid: r.uuid,
      isPrivate: Boolean(r.is_private),
      defaultBranch: r.mainbranch?.name || 'main',
      description: r.description || undefined,
      fullName: r.full_name || `${r.workspace?.slug || workspace}/${r.slug}`,
      updatedOn: r.updated_on,
    }));
  }

  async searchBranches(options: { repository: string; query?: string; limit?: number }): Promise<BitbucketBranchMeta[]> {
    let workspace = '';
    let repoSlug = options.repository;

    if (options.repository.includes('/')) {
      const parts = options.repository.split('/');
      workspace = parts[0];
      repoSlug = parts[1];
    } else {
      workspace = await this.resolveWorkspace();
    }

    if (!workspace) {
      throw new BitbucketError(
        'Workspace is required to search branches in Bitbucket Cloud.',
        'VALIDATION_ERROR',
        400
      );
    }

    const limit = options.limit || 50;
    let path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/branches?pagelen=${limit}`;
    if (options.query?.trim()) {
      path += `&q=${encodeURIComponent(`name~"${options.query.trim()}"`)}`;
    }

    const branches = await this.paginatedValues<any>(path, limit);

    return branches.map((b) => {
      const name = b.name;
      let type: BitbucketBranchMeta['type'] = 'custom';
      if (name === 'main' || name === 'master') {
        type = 'default';
      } else if (name.startsWith('release/')) {
        type = 'release';
      } else if (name.startsWith('feature/')) {
        type = 'feature';
      } else if (name.startsWith('hotfix/')) {
        type = 'hotfix';
      }

      return {
        name,
        displayId: name,
        isDefault: name === 'main' || name === 'master',
        latestCommit: b.target?.hash,
        type,
      };
    });
  }

  async searchUsers(options?: { workspace?: string; query?: string; limit?: number }): Promise<BitbucketUserMeta[]> {
    const workspace = await this.resolveWorkspace(options?.workspace);

    const limit = Math.min(Math.max(options?.limit || 25, 1), 100);
    const query = options?.query?.trim().toLowerCase();
    // Workspace membership does not support filtering by nested user fields.
    // Fetch accessible memberships and apply the display filter locally.
    const members = await this.paginatedValues<any>(
      `/workspaces/${encodeURIComponent(workspace)}/members?pagelen=100`,
      query ? 1000 : limit
    );

    const normalized = members.map((m) => {
      const u = m.user || {};
      const username = u.nickname || u.username || u.account_id || '';
      return {
        username,
        displayName: u.display_name || username,
        email: undefined,
        avatarUrl: u.links?.avatar?.href || null,
        accountId: u.account_id,
        uuid: u.uuid,
        active: true,
      };
    });

    return normalized
      .filter((user) => !query || [user.displayName, user.username, user.accountId]
        .some((value) => value?.toLowerCase().includes(query)))
      .slice(0, limit);
  }

  async searchPullRequests(options: { repository: string; state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'; query?: string; limit?: number }): Promise<PullRequest[]> {
    const parts = options.repository.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BitbucketError('Repository must use the Cloud format workspace/repository-slug.', 'VALIDATION_ERROR', 400);
    }
    const [workspace, slug] = parts;
    const limit = Math.min(Math.max(options.limit || 50, 1), 100);
    let path = `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/pullrequests?state=${options.state || 'OPEN'}&pagelen=${limit}`;
    if (options.query?.trim()) {
      path += `&q=${encodeURIComponent(`title~"${options.query.trim()}"`)}`;
    }
    const items = await this.paginatedValues<any>(path, limit);
    return items.map((item) => this.normalizeCloudPr(item, { projectOrWorkspace: workspace, slug }));
  }

  private normalizeCloudPr(item: any, repo: RepositoryRef): PullRequest {
    const reviewers: PullRequestReviewer[] = (item.participants || []).map((part: any) => {
      const isApproved = Boolean(part.approved);
      const username = part.user?.nickname || part.user?.username || part.user?.account_id || 'unknown';
      return {
        user: {
          username,
          displayName: part.user?.display_name || username,
          avatarUrl: part.user?.links?.avatar?.href,
        },
        status: isApproved ? 'APPROVED' : 'UNAPPROVED',
        isApproved,
      };
    });

    const isDraft = Boolean(
      item.draft ||
      item.title?.trim().toLowerCase().startsWith('[wip]') ||
      item.title?.trim().toLowerCase().startsWith('[draft]')
    );

    return {
      id: item.id,
      title: item.title,
      description: item.summary?.raw || item.description,
      state: (item.state || 'OPEN').toUpperCase() as 'OPEN' | 'MERGED' | 'DECLINED',
      author: {
        username: item.author?.nickname || item.author?.username || item.author?.account_id || 'unknown',
        displayName: item.author?.display_name || item.author?.nickname || 'Unknown',
        avatarUrl: item.author?.links?.avatar?.href,
      },
      repository: {
        projectOrWorkspace: item.destination?.repository?.full_name?.split('/')[0] || repo.projectOrWorkspace,
        slug: item.destination?.repository?.slug || repo.slug,
      },
      sourceBranch: {
        name: item.source?.branch?.name || 'unknown',
        refId: item.source?.branch?.name || '',
        commitHash: item.source?.commit?.hash,
      },
      targetBranch: {
        name: item.destination?.branch?.name || 'unknown',
        refId: item.destination?.branch?.name || '',
        commitHash: item.destination?.commit?.hash,
      },
      reviewers,
      isDraft,
      hasConflicts: false,
      createdDate: new Date(item.created_on || Date.now()).toISOString(),
      updatedDate: new Date(item.updated_on || Date.now()).toISOString(),
      htmlUrl: item.links?.html?.href || `https://bitbucket.org/${repo.projectOrWorkspace}/${repo.slug}/pull-requests/${item.id}`,
    };
  }
}
