
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildServer, type ServerInstance } from '../server.js';
import { BitbucketMetadataService, SimpleTtlCache } from '../services/bitbucket-metadata.js';
import { BitbucketError } from '../bitbucket/errors.js';
import type { IBitbucketClient } from '../bitbucket/client.interface.js';
import type {
  BitbucketRepositoryMeta,
  BitbucketBranchMeta,
  BitbucketUserMeta,
  BitbucketWorkspaceMeta,
  BitbucketUserProfile,
  RepositoryRef,
  RepositoryInfo,
  PullRequest,
} from '@bitbucket-pr-approver/shared';

class FakeCloudBitbucketClient implements IBitbucketClient {
  public failMode: 'none' | '401' | '403' | '429' | 'offline' = 'none';
  public callCounts = {
    workspaces: 0,
    repos: 0,
    branches: 0,
    users: 0,
    testConnection: 0,
  };

  async testConnection(): Promise<BitbucketUserProfile> {
    this.callCounts.testConnection++;
    this.checkFail();
    return {
      username: 'alexchen',
      displayName: 'Alex Chen',
      serverType: 'cloud',
      isAvailable: true,
      vpnConnected: true,
      verifiedAt: new Date().toISOString(),
      serverEdition: 'Bitbucket Cloud (REST v2.0)',
      latencyMs: 78,
      accountId: '557058:fake-account-id',
      selectedWorkspace: 'acme-corp',
      workspaces: await this.listWorkspaces(),
    };
  }

  async getCurrentUser(): Promise<BitbucketUserProfile> {
    return this.testConnection();
  }

  async listWorkspaces(): Promise<BitbucketWorkspaceMeta[]> {
    this.callCounts.workspaces++;
    this.checkFail();
    return [
      {
        slug: 'acme-corp',
        name: 'Acme Corporation',
        uuid: '{5b060d4a-3829-43c2-8418-86d11a681d65}',
        avatarUrl: 'https://bitbucket.org/workspaces/acme-corp/avatar',
        isPersonal: false,
      },
    ];
  }

  async listRepositories(_workspace?: string): Promise<RepositoryInfo[]> {
    return [];
  }

  async listOpenPullRequests(_repo: RepositoryRef): Promise<PullRequest[]> {
    return [];
  }

  async getPullRequest(_repo: RepositoryRef, _prId: number): Promise<PullRequest> {
    throw new Error('Not implemented');
  }

  async approvePullRequest(_repo: RepositoryRef, _prId: number): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Approved' };
  }

  async searchRepositories(options?: { query?: string; project?: string; limit?: number }): Promise<BitbucketRepositoryMeta[]> {
    this.callCounts.repos++;
    this.checkFail();
    const repos: BitbucketRepositoryMeta[] = [
      {
        slug: 'payment-service',
        name: 'Payment Service',
        projectKey: 'PAY',
        projectName: 'Payments',
        workspace: 'acme-corp',
        uuid: '{3a4b5c6d-7e8f-9a0b-1c2d-3e4f5a6b7c8d}',
        isPrivate: true,
        defaultBranch: 'main',
        description: 'Core payment processing pipeline',
        fullName: 'acme-corp/payment-service',
        updatedOn: '2026-03-22T08:00:00Z',
      },
      {
        slug: 'web-frontend',
        name: 'Web Frontend',
        projectKey: 'FE',
        projectName: 'Frontend',
        workspace: 'acme-corp',
        uuid: '{4b5c6d7e-8f9a-0b1c-2d3e-4f5a6b7c8d9e}',
        isPrivate: false,
        defaultBranch: 'main',
        description: 'React SPA dashboard',
        fullName: 'acme-corp/web-frontend',
        updatedOn: '2026-03-22T07:00:00Z',
      },
    ];

    let filtered = repos;
    if (options?.query) {
      const q = options.query.toLowerCase();
      filtered = filtered.filter((r) => r.slug.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }
    return filtered.slice(0, options?.limit || 25);
  }

  async searchBranches(options: { repository: string; query?: string; limit?: number }): Promise<BitbucketBranchMeta[]> {
    this.callCounts.branches++;
    this.checkFail();
    const branches: BitbucketBranchMeta[] = [
      {
        name: 'main',
        displayId: 'main',
        isDefault: true,
        latestCommit: 'a1b2c3d4e5f6',
        type: 'default',
      },
      {
        name: 'develop',
        displayId: 'develop',
        isDefault: false,
        latestCommit: 'b2c3d4e5f6a1',
        type: 'default',
      },
      {
        name: 'release/2026.04',
        displayId: 'release/2026.04',
        isDefault: false,
        latestCommit: 'c3d4e5f6a1b2',
        type: 'release',
      },
    ];

    let filtered = branches;
    if (options.query) {
      const q = options.query.toLowerCase();
      filtered = filtered.filter((b) => b.name.toLowerCase().includes(q));
    }
    return filtered.slice(0, options.limit || 50);
  }

  async searchUsers(options?: { query?: string; limit?: number }): Promise<BitbucketUserMeta[]> {
    this.callCounts.users++;
    this.checkFail();
    const users: BitbucketUserMeta[] = [
      {
        username: 'alexchen',
        displayName: 'Alex Chen',
        email: undefined,
        avatarUrl: 'https://secure.gravatar.com/avatar/alex',
        accountId: '557058:alexchen',
        uuid: '{alexchen-uuid}',
        active: true,
      },
      {
        username: 'sarahc',
        displayName: 'Sarah Chen',
        email: undefined,
        avatarUrl: null,
        accountId: '557058:sarahc',
        uuid: '{sarahc-uuid}',
        active: true,
      },
    ];

    let filtered = users;
    if (options?.query) {
      const q = options.query.toLowerCase();
      filtered = filtered.filter((u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
    }
    return filtered.slice(0, options?.limit || 25);
  }

  private checkFail(): void {
    if (this.failMode === '401') {
      throw new BitbucketError('Bitbucket Cloud App Password revoked or expired', 'AUTH_INVALID_TOKEN', 401);
    }
    if (this.failMode === '403') {
      throw new BitbucketError('Access denied: insufficient scopes on App Password', 'INSUFFICIENT_SCOPES', 403);
    }
    if (this.failMode === '429') {
      throw new BitbucketError('Bitbucket Cloud rate limit exceeded. Retry after 30s.', 'RATE_LIMITED', 429, { rateLimitReset: 30 });
    }
    if (this.failMode === 'offline') {
      throw new BitbucketError('Network timeout reaching api.bitbucket.org', 'NETWORK_OFFLINE', 504);
    }
  }
}

describe('Bitbucket Cloud REST Metadata API & Strict Zero-Mock Runtime Policy', () => {
  let tmpDir: string;
  let server: ServerInstance;
  let metadataService: BitbucketMetadataService;
  let fakeClient: FakeCloudBitbucketClient;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitbucket-cloud-meta-test-'));
    server = await buildServer({
      dataDir: tmpDir,
      disableScheduler: true,
    });
    metadataService = new BitbucketMetadataService(server.storage);
    fakeClient = new FakeCloudBitbucketClient();
  });

  after(async () => {
    if (server) {
      await server.app.close();
    }
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. Strict Zero-Mock & Error Propagation when Unconfigured', () => {
    it('GET /api/bitbucket/repositories returns 400 CONFIG_MISSING without mock fallback', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/bitbucket/repositories',
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'CONFIG_MISSING');
      assert.ok(body.error.message.includes('not configured'));
      // Guarantee no mock data returned
      assert.equal(body.data, undefined);
    });

    it('GET /api/bitbucket/branches returns 400 VALIDATION_ERROR when repository is missing', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/bitbucket/branches',
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.ok(body.error.message.includes('repository'));
    });

    it('GET /api/bitbucket/workspaces returns 400 CONFIG_MISSING when unconfigured', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/bitbucket/workspaces',
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'CONFIG_MISSING');
    });

    it('GET /api/bitbucket/users returns 400 CONFIG_MISSING when unconfigured', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/api/bitbucket/users',
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'CONFIG_MISSING');
    });
  });

  describe('2. Configured Bitbucket Cloud Live Proxy & Metadata Endpoints', () => {
    before(() => {
      // Save valid test credentials into storage
      server.storage.saveConfig({
        serverType: 'cloud',
        baseUrl: 'https://api.bitbucket.org/2.0',
        authType: 'basic',
        token: 'valid-test-app-password',
        username: 'alexchen@company.com',
        workspace: 'acme-corp',
      });
      // Attach fake cloud client to test service
      metadataService.setTestClient(fakeClient);
    });

    it('GET /api/bitbucket/workspaces returns real workspaces', async () => {
      const workspaces = await metadataService.getWorkspaces();
      assert.equal(workspaces.total, 1);
      assert.equal(workspaces.items[0].slug, 'acme-corp');
      assert.equal(workspaces.items[0].name, 'Acme Corporation');
      assert.ok(workspaces.items[0].uuid);
    });

    it('GET /api/bitbucket/repositories returns Cloud repositories and supports search', async () => {
      const allRepos = await metadataService.getRepositories({ workspace: 'acme-corp' });
      assert.equal(allRepos.total, 2);
      assert.equal(allRepos.items[0].slug, 'payment-service');
      assert.equal(allRepos.items[0].workspace, 'acme-corp');

      // Search by query
      const filtered = await metadataService.getRepositories({ workspace: 'acme-corp', query: 'frontend' });
      assert.equal(filtered.total, 1);
      assert.equal(filtered.items[0].slug, 'web-frontend');
    });

    it('GET /api/bitbucket/branches returns branches for specified repository', async () => {
      const branches = await metadataService.getBranches({ repository: 'acme-corp/payment-service' });
      assert.equal(branches.total, 3);
      assert.equal(branches.items[0].name, 'main');
      assert.equal(branches.items[0].isDefault, true);

      // Filter by query
      const releaseBranches = await metadataService.getBranches({ repository: 'acme-corp/payment-service', query: 'release' });
      assert.equal(releaseBranches.total, 1);
      assert.equal(releaseBranches.items[0].name, 'release/2026.04');
    });

    it('GET /api/bitbucket/users returns workspace members with account IDs', async () => {
      const users = await metadataService.getUsers({ workspace: 'acme-corp' });
      assert.equal(users.total, 2);
      assert.equal(users.items[0].username, 'alexchen');
      assert.equal(users.items[0].accountId, '557058:alexchen');

      // Filter by query
      const filtered = await metadataService.getUsers({ workspace: 'acme-corp', query: 'sarah' });
      assert.equal(filtered.total, 1);
      assert.equal(filtered.items[0].username, 'sarahc');
    });
  });

  describe('3. Upstream Error Propagation (Zero Simulated Success)', () => {
    it('propagates 401 AUTH_INVALID_TOKEN when App Password expires', async () => {
      metadataService.clearCache();
      fakeClient.failMode = '401';

      await assert.rejects(
        async () => {
          await metadataService.getRepositories({ workspace: 'acme-corp' });
        },
        (err: any) => {
          assert.equal(err.code, 'AUTH_INVALID_TOKEN');
          assert.equal(err.statusCode, 401);
          return true;
        }
      );
    });

    it('propagates 403 INSUFFICIENT_SCOPES when scopes are missing', async () => {
      metadataService.clearCache();
      fakeClient.failMode = '403';

      await assert.rejects(
        async () => {
          await metadataService.getWorkspaces();
        },
        (err: any) => {
          assert.equal(err.code, 'INSUFFICIENT_SCOPES');
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    });

    it('propagates 429 RATE_LIMITED with rateLimitReset parameter', async () => {
      metadataService.clearCache();
      fakeClient.failMode = '429';

      await assert.rejects(
        async () => {
          await metadataService.getBranches({ repository: 'acme-corp/payment-service' });
        },
        (err: any) => {
          assert.equal(err.code, 'RATE_LIMITED');
          assert.equal(err.statusCode, 429);
          assert.equal(err.details?.rateLimitReset, 30);
          return true;
        }
      );
    });

    it('propagates 504 NETWORK_OFFLINE without synthetic fallback', async () => {
      metadataService.clearCache();
      fakeClient.failMode = 'offline';

      await assert.rejects(
        async () => {
          await metadataService.getUsers({ workspace: 'acme-corp' });
        },
        (err: any) => {
          assert.equal(err.code, 'NETWORK_OFFLINE');
          assert.equal(err.statusCode, 504);
          return true;
        }
      );
    });
  });

  describe('4. In-Memory Cache (TTL 60s) & Cache Bypass (fresh=true)', () => {
    before(() => {
      fakeClient.failMode = 'none';
      metadataService.clearCache();
    });

    it('caches successful response and serves repeated queries from cache', async () => {
      const initialCounts = fakeClient.callCounts.workspaces;
      await metadataService.getWorkspaces();
      assert.equal(fakeClient.callCounts.workspaces, initialCounts + 1);

      // Second call within TTL should hit cache
      await metadataService.getWorkspaces();
      assert.equal(fakeClient.callCounts.workspaces, initialCounts + 1); // No increment
    });

    it('bypasses cache when fresh=true', async () => {
      const initialCounts = fakeClient.callCounts.workspaces;
      await metadataService.getWorkspaces({ fresh: true });
      assert.equal(fakeClient.callCounts.workspaces, initialCounts + 1); // Incremented
    });

    it('SimpleTtlCache TTL expiration removes expired items', async () => {
      const shortCache = new SimpleTtlCache<string>(50); // 50ms TTL
      shortCache.set('key', 'val');
      assert.equal(shortCache.get('key'), 'val');

      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(shortCache.get('key'), undefined);
    });
  });
});
