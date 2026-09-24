import type { FastifyInstance } from 'fastify';
import type { CreateJobDto, UpdateJobDto } from '@bitbucket-pr-approver/shared';
import type { StorageService } from '../services/storage.js';
import type { SchedulerService } from '../services/scheduler.js';
import type { ExecutionDispatcher } from '../services/execution-dispatcher.js';
import type { WorkerStore } from '../services/worker-store.js';

export async function registerJobRoutes(
  app: FastifyInstance,
  options: {
    storage: StorageService;
    scheduler: SchedulerService;
    executionDispatcher?: ExecutionDispatcher;
    workerStore?: WorkerStore;
  }
): Promise<void> {
  const { storage, scheduler, executionDispatcher, workerStore } = options;

  app.get('/api/jobs', async (_req, reply) => {
    const jobs = storage.getJobs();
    return reply.send({
      success: true,
      data: jobs,
    });
  });

  app.post<{ Body: CreateJobDto }>('/api/jobs', async (req, reply) => {
    const body = req.body;
    if (!body || !body.name || !body.rules) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Job name and rules are required',
        },
      });
    }

    if (body.executionMode === 'worker') {
      const worker = body.workerId ? workerStore?.getWorker(body.workerId) : null;
      if (!worker || worker.revokedAt) {
        return reply.status(400).send({
          success: false,
          error: { code: 'WORKER_REQUIRED', message: 'A valid local worker is required' },
        });
      }
    }

    const created = storage.createJob(body);
    return reply.status(201).send({
      success: true,
      data: created,
    });
  });

  app.put<{ Params: { id: string }; Body: UpdateJobDto }>('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params;
    const body = req.body;

    if (body.executionMode === 'worker') {
      const worker = body.workerId ? workerStore?.getWorker(body.workerId) : null;
      if (!worker || worker.revokedAt) {
        return reply.status(400).send({
          success: false,
          error: { code: 'WORKER_REQUIRED', message: 'A valid local worker is required' },
        });
      }
    }

    const updated = storage.updateJob(id, body);
    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: `Job with ID '${id}' not found`,
        },
      });
    }

    return reply.send({
      success: true,
      data: updated,
    });
  });

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params;
    const deleted = storage.deleteJob(id);
    if (!deleted) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: `Job with ID '${id}' not found`,
        },
      });
    }

    return reply.send({
      success: true,
      data: { id, message: 'Job deleted successfully' },
    });
  });

  app.post<{ Params: { id: string }; Body?: { enabled?: boolean } }>(
    '/api/jobs/:id/toggle',
    async (req, reply) => {
      const { id } = req.params;
      const current = storage.getJobById(id);

      if (!current) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'JOB_NOT_FOUND',
            message: `Job with ID '${id}' not found`,
          },
        });
      }

      const requestedEnabled = req.body?.enabled;
      const updated = storage.toggleJob(
        id,
        typeof requestedEnabled === 'boolean' ? requestedEnabled : !current.enabled
      );

      return reply.send({
        success: true,
        data: updated,
      });
    }
  );

  app.post<{ Params: { id: string } }>('/api/jobs/:id/run-now', async (req, reply) => {
    const { id } = req.params;
    const job = storage.getJobById(id);
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'JOB_NOT_FOUND',
          message: `Job with ID '${id}' not found`,
        },
      });
    }

    if ((job.executionMode ?? 'local') === 'worker') {
      try {
        const lease = executionDispatcher?.manualRun(id);
        if (!lease) {
          throw Object.assign(new Error('Worker execution dispatcher is unavailable'), {
            code: 'WORKER_DISPATCH_UNAVAILABLE',
            statusCode: 503,
          });
        }
        return reply.status(202).send({
          success: true,
          message: `Job '${job.name}' queued for local worker`,
          data: lease,
        });
      } catch (error: any) {
        return reply.status(error.statusCode || 409).send({
          success: false,
          error: { code: error.code || 'WORKER_NOT_ONLINE', message: error.message },
        });
      }
    }

    scheduler.runJobNow(id).catch(() => {});

    return reply.send({
      success: true,
      message: `Job '${job.name}' execution triggered`,
    });
  });
}
