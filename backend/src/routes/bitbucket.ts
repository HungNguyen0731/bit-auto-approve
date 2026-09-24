import type { FastifyInstance } from 'fastify';
import { BitbucketMetadataService } from '../services/bitbucket-metadata.js';
import type { StorageService } from '../services/storage.js';

export async function registerBitbucketMetadataRoutes(
  app: FastifyInstance,
  options: { storage: StorageService; metadataService?: BitbucketMetadataService }
): Promise<void> {
  const metadataService = options.metadataService || new BitbucketMetadataService(options.storage);

  // Helper to format structured error responses
  const sendErrorReply = (reply: any, err: any) => {
    const status = err.statusCode || 500;
    return reply.status(status).send({
      success: false,
      error: {
        code: err.code || 'GENERIC_API_ERROR',
        message: err.message || 'Bitbucket Cloud API error',
        httpStatus: status,
        rateLimitReset: err.details?.rateLimitReset ?? null,
        details: err.details ?? null,
      },
    });
  };

  // 1. GET /api/bitbucket/workspaces
  app.get<{
    Querystring: {
      fresh?: string;
    };
  }>('/api/bitbucket/workspaces', async (req, reply) => {
    try {
      const data = await metadataService.getWorkspaces({
        fresh: req.query.fresh === 'true',
      });
      return reply.send({
        success: true,
        data,
      });
    } catch (err: any) {
      return sendErrorReply(reply, err);
    }
  });

  // 2. GET /api/bitbucket/repositories
  app.get<{
    Querystring: {
      workspace?: string;
      project?: string;
      query?: string;
      limit?: string;
      fresh?: string;
    };
  }>('/api/bitbucket/repositories', async (req, reply) => {
    try {
      const { workspace, project, query, limit, fresh } = req.query;
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;

      const data = await metadataService.getRepositories({
        workspace,
        project,
        query,
        limit: parsedLimit,
        fresh: fresh === 'true',
      });

      return reply.send({
        success: true,
        data,
      });
    } catch (err: any) {
      return sendErrorReply(reply, err);
    }
  });

  // 3. GET /api/bitbucket/branches
  app.get<{
    Querystring: {
      repository?: string;
      query?: string;
      limit?: string;
      fresh?: string;
    };
  }>('/api/bitbucket/branches', async (req, reply) => {
    const { repository, query, limit, fresh } = req.query;

    if (!repository || !repository.trim()) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: "Query parameter 'repository' is required (e.g. WORKSPACE/repo-slug)",
          httpStatus: 400,
          rateLimitReset: null,
          details: null,
        },
      });
    }

    try {
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;

      const data = await metadataService.getBranches({
        repository: repository.trim(),
        query,
        limit: parsedLimit,
        fresh: fresh === 'true',
      });

      return reply.send({
        success: true,
        data,
      });
    } catch (err: any) {
      return sendErrorReply(reply, err);
    }
  });

  // 4. GET /api/bitbucket/users
  app.get<{
    Querystring: {
      workspace?: string;
      project?: string;
      query?: string;
      limit?: string;
      fresh?: string;
    };
  }>('/api/bitbucket/users', async (req, reply) => {
    try {
      const { workspace, project, query, limit, fresh } = req.query;
      const parsedLimit = limit ? parseInt(limit, 10) : undefined;

      const data = await metadataService.getUsers({
        workspace,
        project,
        query,
        limit: parsedLimit,
        fresh: fresh === 'true',
      });

      return reply.send({
        success: true,
        data,
      });
    } catch (err: any) {
      return sendErrorReply(reply, err);
    }
  });

  // 5. GET /api/bitbucket/pull-requests
  app.get<{
    Querystring: { repository?: string; state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'; query?: string; limit?: string };
  }>('/api/bitbucket/pull-requests', async (req, reply) => {
    const repository = req.query.repository?.trim();
    if (!repository) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: "Query parameter 'repository' is required", httpStatus: 400, rateLimitReset: null, details: null } });
    }
    try {
      const config = options.storage.getConfig();
      if (!config?.token) {
        throw Object.assign(new Error('Bitbucket Cloud credentials are not configured.'), { code: 'CONFIG_MISSING', statusCode: 400 });
      }
      const client = (await import('../bitbucket/index.js')).createBitbucketClient(config);
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const items = await client.searchPullRequests!({ repository, state: req.query.state, query: req.query.query, limit });
      return reply.send({ success: true, data: { items, total: items.length } });
    } catch (err: any) {
      return sendErrorReply(reply, err);
    }
  });


  // 5. POST /api/bitbucket/cache/clear (Clear short-term metadata cache)
  app.post('/api/bitbucket/cache/clear', async (_req, reply) => {
    metadataService.clearCache();
    return reply.send({
      success: true,
      data: {
        message: 'Bitbucket metadata cache cleared successfully',
      },
    });
  });
}
