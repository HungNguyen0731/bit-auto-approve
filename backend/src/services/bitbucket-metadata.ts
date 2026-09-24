import type {
  BitbucketRepositoryMeta,
  BitbucketBranchMeta,
  BitbucketUserMeta,
  BitbucketWorkspaceMeta,
  BitbucketMetadataList,
} from '@bitbucket-pr-approver/shared';
import type { StorageService } from './storage.js';
import { createBitbucketClient, BitbucketError, type IBitbucketClient } from '../bitbucket/index.js';

export class SimpleTtlCache<T = unknown> {
  private cache = new Map<string, { value: T; expiresAt: number }>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  get size(): number {
    return this.cache.size;
  }
}

export class BitbucketMetadataService {
  private storage: StorageService;
  private cache: SimpleTtlCache<BitbucketMetadataList<any>>;
  private testClient?: IBitbucketClient;

  constructor(storage: StorageService, cacheTtlMs: number = 60 * 1000) {
    this.storage = storage;
    this.cache = new SimpleTtlCache(cacheTtlMs);
  }

  public setTestClient(client: IBitbucketClient): void {
    this.testClient = client;
  }

  public getCache(): SimpleTtlCache<BitbucketMetadataList<any>> {
    return this.cache;
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private getClient(): IBitbucketClient {
    if (this.testClient) {
      return this.testClient;
    }
    const config = this.storage.getConfig();
    if (!config || !config.token) {
      throw new BitbucketError(
        'Bitbucket Cloud credentials are not configured. Please complete onboarding with your Atlassian username and App Password.',
        'CONFIG_MISSING',
        400
      );
    }
    return createBitbucketClient(config);
  }

  async getWorkspaces(params?: { fresh?: boolean }): Promise<BitbucketMetadataList<BitbucketWorkspaceMeta>> {
    const cacheKey = 'workspaces';
    if (!params?.fresh) {
      const cached = this.cache.get(cacheKey) as BitbucketMetadataList<BitbucketWorkspaceMeta> | undefined;
      if (cached) {
        return cached;
      }
    }

    const client = this.getClient();
    const items = await client.listWorkspaces();
    const result: BitbucketMetadataList<BitbucketWorkspaceMeta> = {
      items,
      total: items.length,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  async getRepositories(params: {
    workspace?: string;
    project?: string;
    query?: string;
    limit?: number;
    fresh?: boolean;
  }): Promise<BitbucketMetadataList<BitbucketRepositoryMeta>> {
    const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 100);
    const query = params.query?.trim().toLowerCase() || '';
    const config = this.storage.getConfig();
    const workspace = (params.workspace || params.project || config?.workspace || '').trim();

    const cacheKey = `repos:${workspace}:${query}:${limit}`;
    if (!params?.fresh) {
      const cached = this.cache.get(cacheKey) as BitbucketMetadataList<BitbucketRepositoryMeta> | undefined;
      if (cached) {
        return cached;
      }
    }

    const client = this.getClient();
    const items = await client.searchRepositories({
      query: params.query?.trim(),
      project: workspace,
      limit,
    });

    const result: BitbucketMetadataList<BitbucketRepositoryMeta> = {
      items,
      total: items.length,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  async getBranches(params: {
    repository: string;
    query?: string;
    limit?: number;
    fresh?: boolean;
  }): Promise<BitbucketMetadataList<BitbucketBranchMeta>> {
    const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
    const query = params.query?.trim().toLowerCase() || '';
    const repository = params.repository.trim();

    const cacheKey = `branches:${repository}:${query}:${limit}`;
    if (!params?.fresh) {
      const cached = this.cache.get(cacheKey) as BitbucketMetadataList<BitbucketBranchMeta> | undefined;
      if (cached) {
        return cached;
      }
    }

    const client = this.getClient();
    const items = await client.searchBranches({
      repository,
      query: params.query?.trim(),
      limit,
    });

    const result: BitbucketMetadataList<BitbucketBranchMeta> = {
      items,
      total: items.length,
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  async getUsers(params: {
    workspace?: string;
    project?: string;
    query?: string;
    limit?: number;
    fresh?: boolean;
  }): Promise<BitbucketMetadataList<BitbucketUserMeta>> {
    const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 100);
    const query = params.query?.trim().toLowerCase() || '';
    const config = this.storage.getConfig();
    const workspace = (params.workspace || params.project || config?.workspace || '').trim();

    const cacheKey = `users:${workspace}:${query}:${limit}`;
    if (!params?.fresh) {
      const cached = this.cache.get(cacheKey) as BitbucketMetadataList<BitbucketUserMeta> | undefined;
      if (cached) {
        return cached;
      }
    }

    const client = this.getClient();
    const items = await client.searchUsers({
      workspace,
      query: params.query?.trim(),
      limit,
    });

    const result: BitbucketMetadataList<BitbucketUserMeta> = {
      items,
      total: items.length,
    };

    this.cache.set(cacheKey, result);
    return result;
  }
}
