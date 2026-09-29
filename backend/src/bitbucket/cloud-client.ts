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
  private static pacedRequestQueue: Promise<void> = Promise.resolve();
  private static nextPacedRequestAt = 0;
  private readonly baseUrl: string;
  private readonly config: BitbucketConnectionConfig;
  private readonly dispatcher?: Dispatcher;
  private readonly minRequestIntervalMs: number;
  private readonly sessionCookie?: string;
  private readonly sessionCsrfToken?: string;

  constructor(config: BitbucketConnectionConfig, minRequestIntervalMs = 0) {
    this.config = config;
    this.minRequestIntervalMs = Math.min(Math.max(minRequestIntervalMs, 0), 10_000);

    let cookie = config.cookie;
    let csrfToken = config.csrfToken;
    if ((!cookie || !csrfToken) && config.token) {
      try {
        const parsed = JSON.parse(config.token);
        if (typeof parsed === 'object' && parsed !== null) {
          cookie = cookie || parsed.cookie;
          csrfToken = csrfToken || parsed.csrfToken;
        }
      } catch {
        // token might not be JSON
      }
    }
    this.sessionCookie = cookie;
    this.sessionCsrfToken = csrfToken;

    // Standardize on Bitbucket Session Auth (!api/2.0)
    const isSessionAuth = config.authType === 'session' || Boolean(cookie || csrfToken) || (!config.authType && !config.token);
    const isExplicitLegacy = !isSessionAuth && (config.authType === 'basic' || config.authType === 'bearer');

    this.baseUrl = isExplicitLegacy
      ? 'https://api.bitbucket.org/2.0'
      : 'https://bitbucket.org/!api/2.0';

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

  private getAuthHeader(): string | undefined {
    const { authType, token, username } = this.config;
    if (authType === 'session' || this.sessionCookie || this.sessionCsrfToken) {
      return undefined;
    }
    if (authType === 'basic' && username && token) {
      const creds = Buffer.from(`${username}:${token}`).toString('base64');
      return `Basic ${creds}`;
    }
    if (token) {
      return `Bearer ${token}`;
    }
    return undefined;
  }

  private async paceRequest(): Promise<void> {
    if (this.minRequestIntervalMs === 0) return;
    const turn = BitbucketCloudClient.pacedRequestQueue.then(async () => {
      const waitMs = Math.max(0, BitbucketCloudClient.nextPacedRequestAt - Date.now());
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      BitbucketCloudClient.nextPacedRequestAt = Date.now() + this.minRequestIntervalMs;
    });
    BitbucketCloudClient.pacedRequestQueue = turn.catch(() => {});
    await turn;
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
      ...options.headers,
    };

    const authHeader = this.getAuthHeader();
    if (authHeader) {
      headers.Authorization = authHeader;
    } else {
      if (this.sessionCookie) {
        headers.cookie = this.sessionCookie;
      }
      if (this.sessionCsrfToken) {
        headers['x-csrftoken'] = this.sessionCsrfToken;
      }
      headers['x-requested-with'] = 'XMLHttpRequest';
      headers['origin'] = 'https://bitbucket.org';
      if (!headers['referer']) {
        headers['referer'] = 'https://bitbucket.org/';
      }
      headers['user-agent'] =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    }

    let bodyStr: string | undefined;
    if (options.body) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(options.body);
    }

    try {
      await this.paceRequest();
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: bodyStr,
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(timeout),
      });

      if (response.status === 401) {
        throw new BitbucketError(
          this.config.authType === 'session'
            ? 'Bitbucket Cloud session authentication failed (HTTP 401). Your cookie or CSRF token may be expired, invalid, or incomplete. Make sure to copy the full cookie string from the browser.'
            : 'Authentication failed on Bitbucket Cloud (HTTP 401). Invalid username or App Password.',
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

      if (response.status === 405) {
        let errBody: string = '';
        try {
          errBody = await response.text();
        } catch {
          // ignore
        }
        const allow = response.headers.get('allow');
        throw new BitbucketError(
          `Method Not Allowed on Bitbucket Cloud (HTTP 405) for ${options.method || 'GET'} ${url}.${allow ? ` Allowed methods: ${allow}.` : ''}${errBody ? ` - ${errBody}` : ''}`,
          'GENERIC_API_ERROR',
          405,
          { responseBody: errBody, method: options.method || 'GET', url, allow }
        );
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const seconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim())
          ? Number(retryAfterHeader.trim()) : NaN;
        const resetAt = retryAfterHeader && !Number.isFinite(seconds)
          ? Date.parse(retryAfterHeader) : NaN;
        const retryAfter = Math.min(3600, Math.max(1, Number.isFinite(seconds) ? seconds
          : Number.isFinite(resetAt) ? Math.ceil((resetAt - Date.now()) / 1000) : 30));
        await response.body?.cancel();
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

  async listWorkspaceOpenPullRequests(workspace: string, reviewerUuid?: string): Promise<PullRequest[]> {
    const items: PullRequest[] = [];
    const pageSize = 100;
    const reviewer = reviewerUuid?.replace(/^\{|\}$/g, '');
    const filter = 'state="OPEN" AND draft=false AND queued=false' +
      (reviewer ? ` AND reviewers.uuid="${reviewer}"` : '');
    const query = encodeURIComponent(filter);
    // The internal workspace list omits nested repository/commit fields unless
    // requested explicitly. Those fields identify the repo and exact CI commit.
    const fields = encodeURIComponent([
      '+values.destination.repository.full_name',
      '+values.destination.repository.slug',
      '+values.destination.branch.name',
      '+values.source.branch.name',
      '+values.source.commit.hash',
      '+values.participants.user.nickname',
      '+values.participants.user.account_id',
      '+values.participants.approved',
      '+values.links.html.href',
    ].join(','));
    let complete = false;
    for (let page = 1; page <= 1000; page++) {
      const path = `https://bitbucket.org/!api/internal/workspaces/${encodeURIComponent(workspace)}/pullrequests/?page=${page}&pagelen=${pageSize}&q=${query}&fields=${fields}`;
      const response = await this.request<{ values?: any[]; page?: number; pagelen?: number; size?: number; next?: string }>(path, {
        headers: { referer: `https://bitbucket.org/${encodeURIComponent(workspace)}/pull-requests/` },
      });
      const values = response.values || [];
      let missingRepository = 0;
      for (const item of values) {
        const repository = item.destination?.repository;
        let fullName = repository?.full_name;
        if (!fullName && repository?.slug) fullName = `${workspace}/${repository.slug}`;
        if (!fullName && typeof item.links?.html?.href === 'string') {
          try {
            const url = new URL(item.links.html.href);
            const parts = url.hostname === 'bitbucket.org' ? url.pathname.split('/').filter(Boolean) : [];
            if (parts.length >= 4 && parts[2] === 'pull-requests') fullName = `${parts[0]}/${parts[1]}`;
          } catch { /* Ignore malformed PR link. */ }
        }
        const parts = typeof fullName === 'string' ? fullName.split('/') : [];
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          missingRepository++;
          continue;
        }
        items.push(this.normalizeCloudPr(item, { projectOrWorkspace: parts[0], slug: parts[1] }));
      }
      if (missingRepository > 0) {
        console.warn(`Skipped ${missingRepository} workspace PR(s) without an identifiable destination repository`);
      }
      const effectivePageSize = response.pagelen || pageSize;
      const currentPage = response.page || page;
      if (values.length === 0 ||
          (response.size !== undefined && currentPage * effectivePageSize >= response.size) ||
          (response.size === undefined && !response.next && values.length < effectivePageSize)) {
        complete = true;
        break;
      }
    }
    if (!complete) {
      throw new BitbucketError('Workspace PR list exceeds the supported scan limit.', 'GENERIC_API_ERROR', 502);
    }
    return items;
  }

  async getPullRequest(repo: RepositoryRef, prId: number): Promise<PullRequest> {
    const path = `/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests/${prId}`;
    const item = await this.request<any>(path);
    return this.normalizeCloudPr(item, repo);
  }

  async approvePullRequest(repo: RepositoryRef, prId: number): Promise<{ success: boolean; message: string }> {
    const isSession = this.config.authType === 'session' || Boolean(this.sessionCookie || this.sessionCsrfToken);
    if (isSession) {
      const url = `https://bitbucket.org/!api/2.0/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests/${prId}/approve`;
      const prUrl = `https://bitbucket.org/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pull-requests/${prId}`;
      const headers: Record<string, string> = {
        'x-csrftoken': this.sessionCsrfToken || '',
        'x-requested-with': 'XMLHttpRequest',
        origin: 'https://bitbucket.org',
        referer: prUrl,
        ...(this.sessionCookie ? { cookie: this.sessionCookie } : {}),
      };
      const res = await this.request<any>(url, { method: 'POST', body: {}, headers });
      const status = res?.status || 'APPROVED';
      return {
        success: true,
        message: `Successfully approved PR #${prId} in ${repo.projectOrWorkspace}/${repo.slug} (Status: ${status})`,
      };
    }

    const path = `/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests/${prId}/approve`;
    const res = await this.request<any>(path, { method: 'POST', body: {} });
    const status = res?.status || 'APPROVED';
    return {
      success: true,
      message: `Successfully approved PR #${prId} in ${repo.projectOrWorkspace}/${repo.slug} (Status: ${status})`,
    };
  }

  async getCommitBuildStatus(repo: RepositoryRef, commitHash: string): Promise<'SUCCESSFUL' | 'PENDING' | 'FAILED'> {
    if (!/^[a-f0-9]{7,64}$/i.test(commitHash)) return 'PENDING';
    const prefix = `/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}`;
    const statuses = await this.paginatedValues<any>(
      `${prefix}/commit/${encodeURIComponent(commitHash)}/statuses?pagelen=100`, 1000
    );
    if (statuses.length === 0) return 'PENDING';
    const latestByKey = new Map<string, any>();
    for (const status of statuses) {
      const key = String(status.key || status.uuid || status.name || 'default');
      const previous = latestByKey.get(key);
      if (!previous || Date.parse(status.updated_on || status.created_on || '') >
          Date.parse(previous.updated_on || previous.created_on || '')) latestByKey.set(key, status);
    }
    const states = [...latestByKey.values()].map((status) => String(status.state || '').toUpperCase());
    if (states.some((state) => ['FAILED', 'STOPPED'].includes(state))) return 'FAILED';
    return states.every((state) => state === 'SUCCESSFUL') ? 'SUCCESSFUL' : 'PENDING';
  }

  async mergePullRequest(repo: RepositoryRef, prId: number): Promise<void> {
    const isSession = this.config.authType === 'session' || Boolean(this.sessionCookie || this.sessionCsrfToken);
    if (isSession) {
      const url = `https://bitbucket.org/!api/2.0/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests/${prId}/merge?async=true`;
      const prUrl = `https://bitbucket.org/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pull-requests/${prId}`;
      const headers: Record<string, string> = {
        'x-csrftoken': this.sessionCsrfToken || '',
        'x-requested-with': 'XMLHttpRequest',
        origin: 'https://bitbucket.org',
        referer: prUrl,
        ...(this.sessionCookie ? { cookie: this.sessionCookie } : {}),
      };
      await this.request(url, { method: 'POST', body: { close_source_branch: false }, headers });
      return;
    }

    const path = `/repositories/${encodeURIComponent(repo.projectOrWorkspace)}/${encodeURIComponent(repo.slug)}/pullrequests/${prId}/merge`;
    await this.request(path, { method: 'POST', body: { close_source_branch: false } });
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
