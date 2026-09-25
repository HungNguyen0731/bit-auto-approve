import type { FastifyInstance } from 'fastify';
import type { BitbucketAuthType } from '@bitbucket-pr-approver/shared';
import type { AccountStore } from '../services/account-store.js';
import type { StorageService } from '../services/storage.js';
import type { WorkerStore } from '../services/worker-store.js';

interface AccountBody {
  name: string;
  username?: string;
  authType: BitbucketAuthType;
  token?: string;
}

export async function registerAccountRoutes(app: FastifyInstance, options: {
  accounts: AccountStore;
  storage: StorageService;
  workers: WorkerStore;
}): Promise<void> {
  const { accounts, storage, workers } = options;
  app.get('/api/accounts', async (_request, reply) => reply.send({ success: true, data: accounts.list() }));

  app.post<{ Body: AccountBody }>('/api/accounts', async (request, reply) => {
    try {
      const account = accounts.save(request.body || {} as AccountBody);
      return reply.status(201).send({ success: true, data: account });
    } catch (error: any) {
      return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'VALIDATION_ERROR', message: error.message } });
    }
  });

  app.put<{ Params: { id: string }; Body: AccountBody }>('/api/accounts/:id', async (request, reply) => {
    try {
      const account = accounts.save(request.body || {} as AccountBody, request.params.id);
      return reply.send({ success: true, data: account });
    } catch (error: any) {
      return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'VALIDATION_ERROR', message: error.message } });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
    if (storage.getJobs().some((job) => job.accountId === request.params.id) ||
        workers.getLeases().some((lease) => lease.job.accountId === request.params.id && ['QUEUED', 'LEASED', 'RUNNING', 'RETRYABLE'].includes(lease.status))) {
      return reply.status(409).send({ success: false, error: { code: 'ACCOUNT_IN_USE', message: 'Remove this account from its jobs first' } });
    }
    if (!accounts.delete(request.params.id)) {
      return reply.status(404).send({ success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: 'Bitbucket account not found' } });
    }
    return reply.send({ success: true, data: { removed: true } });
  });
}
