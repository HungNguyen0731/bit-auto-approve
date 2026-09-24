import type { FastifyInstance } from 'fastify';
import type { StorageService } from '../services/storage.js';

export async function registerLogsRoutes(
  app: FastifyInstance,
  options: { storage: StorageService }
): Promise<void> {
  const { storage } = options;

  app.get<{
    Querystring: {
      page?: string;
      limit?: string;
      jobId?: string;
      status?: string;
      repo?: string;
      search?: string;
    };
  }>('/api/logs', async (req, reply) => {
    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    const { jobId, status, repo, search } = req.query;

    const data = storage.getLogs({
      page,
      limit,
      jobId,
      status,
      repo,
      search,
    });

    return reply.send({
      success: true,
      data,
    });
  });

  app.get('/api/logs/stats', async (_req, reply) => {
    const stats = storage.getLogStats();
    return reply.send({
      success: true,
      data: stats,
    });
  });

  app.delete('/api/logs', async (_req, reply) => {
    storage.clearLogs();
    return reply.send({
      success: true,
      data: { message: 'Logs cleared successfully' },
    });
  });
}
