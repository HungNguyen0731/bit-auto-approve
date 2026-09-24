import type { WorkerRecord } from '@bitbucket-pr-approver/shared';
import type { WorkerStore } from './worker-store.js';

export class WorkerAuth {
  constructor(private readonly workerStore: WorkerStore) {}

  authenticate(workerId: string, authorization?: string): WorkerRecord {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const worker = match ? this.workerStore.authenticateWorker(workerId, match[1]) : null;
    if (!worker) {
      throw Object.assign(new Error('Worker credential is invalid or revoked'), {
        code: 'WORKER_UNAUTHORIZED',
        statusCode: 401,
      });
    }
    return worker;
  }
}
