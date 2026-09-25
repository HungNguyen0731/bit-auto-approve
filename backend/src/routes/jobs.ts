import type { FastifyInstance } from 'fastify';
import type { CreateJobDto, UpdateJobDto } from '@bitbucket-pr-approver/shared';
import type { StorageService } from '../services/storage.js';
import type { SchedulerService } from '../services/scheduler.js';
import type { ExecutionDispatcher } from '../services/execution-dispatcher.js';
import type { WorkerStore } from '../services/worker-store.js';
import type { AccountStore } from '../services/account-store.js';

export async function registerJobRoutes(
  app: FastifyInstance,
  options: {
    storage: StorageService;
    scheduler: SchedulerService;
    executionDispatcher?: ExecutionDispatcher;
    workerStore?: WorkerStore;
    accounts?: AccountStore;
  }
): Promise<void> {
  const { storage, scheduler, executionDispatcher, workerStore, accounts } = options;

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

    if (process.env.NODE_ENV === 'production' && body.executionMode !== 'worker') {
      return reply.status(409).send({ success: false, error: {
        code: 'LOCAL_WORKER_REQUIRED', message: 'Assign a paired Mac Worker; jobs cannot run on the cloud server',
      } });
    }

    if (body.executionMode === 'worker') {
      const worker = body.workerId ? workerStore?.getWorker(body.workerId) : null;
      if (!worker || worker.revokedAt) {
        return reply.status(400).send({
          success: false,
          error: { code: 'WORKER_REQUIRED', message: 'A valid local worker is required' },
        });
      }
      if (body.accountId && !accounts?.get(body.accountId)) {
        return reply.status(400).send({ success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'Select an existing Bitbucket account' } });
      }
      if (body.accountId && worker.supportsAccountLeases !== true) {
        return reply.status(409).send({ success: false, error: { code: 'WORKER_UPGRADE_REQUIRED', message: 'Update and reconnect this Mac Worker before assigning an account' } });
      }
    } else if (body.accountId) {
      return reply.status(400).send({ success: false, error: { code: 'ACCOUNT_REQUIRES_WORKER', message: 'Stored Bitbucket accounts require a Local Worker job' } });
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
    if (!body) return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Job body is required' } });

    const currentJob = storage.getJobById(id);
    const nextMode = body.executionMode ?? currentJob?.executionMode ?? 'local';
    const nextAccountId = body.accountId ?? currentJob?.accountId;
    if (process.env.NODE_ENV === 'production' && nextMode !== 'worker') {
      return reply.status(409).send({ success: false, error: {
        code: 'LOCAL_WORKER_REQUIRED', message: 'Assign a paired Mac Worker; legacy Server jobs cannot run on the cloud server',
      } });
    }
    if (nextMode === 'worker') {
      const workerId = body.workerId ?? currentJob?.workerId;
      const worker = workerId ? workerStore?.getWorker(workerId) : null;
      if (!worker || worker.revokedAt) {
        return reply.status(400).send({
          success: false,
          error: { code: 'WORKER_REQUIRED', message: 'A valid local worker is required' },
        });
      }
      if (nextAccountId && !accounts?.get(nextAccountId)) {
        return reply.status(400).send({ success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'Select an existing Bitbucket account' } });
      }
      if (nextAccountId && worker.supportsAccountLeases !== true) {
        return reply.status(409).send({ success: false, error: { code: 'WORKER_UPGRADE_REQUIRED', message: 'Update and reconnect this Mac Worker before assigning an account' } });
      }
    } else if (body.accountId) {
      return reply.status(400).send({ success: false, error: { code: 'ACCOUNT_REQUIRES_WORKER', message: 'Stored Bitbucket accounts require a Local Worker job' } });
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

  app.post<{ Params: { id: string }; Body?: { username?: string; token?: string; tokenCiphertext?: string } }>('/api/jobs/:id/run-now', async (req, reply) => {
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
        const ciphertext = req.body?.tokenCiphertext;
        if (req.body?.token || (ciphertext && (!/^[A-Za-z0-9_-]{64,8192}$/.test(ciphertext) ||
            (req.body?.username && req.body.username.length > 320)))) {
          return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Use a valid encrypted Worker token' } });
        }
        const lease = executionDispatcher?.manualRun(id, ciphertext ? { ciphertext, username: req.body?.username?.trim() } : undefined);
        if (!lease) {
          throw Object.assign(new Error('Worker execution dispatcher is unavailable'), {
            code: 'WORKER_DISPATCH_UNAVAILABLE',
            statusCode: 503,
          });
        }
        return reply.status(202).send({
          success: true,
          message: `Job '${job.name}' queued for local worker`,
          data: { executionId: lease.executionId },
        });
      } catch (error: any) {
        return reply.status(error.statusCode || 409).send({
          success: false,
          error: { code: error.code || 'WORKER_NOT_ONLINE', message: error.message },
        });
      }
    }

    if (process.env.NODE_ENV === 'production') {
      return reply.status(409).send({ success: false, error: {
        code: 'LOCAL_WORKER_REQUIRED', message: 'This Server job cannot run on Coolify. Assign a paired Mac Worker and Bitbucket account first',
      } });
    }

    if (req.body?.tokenCiphertext || (req.body?.token && (req.body.token.length > 8192 ||
        (req.body.username && req.body.username.length > 320)))) {
      return reply.status(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid manual credential' } });
    }
    scheduler.runJobNow(id, req.body?.token ? { token: req.body.token, username: req.body.username?.trim() } : undefined).catch(() => {});

    return reply.send({
      success: true,
      message: `Job '${job.name}' execution triggered`,
    });
  });
}
