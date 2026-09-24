import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  EncryptedTokenEnvelope,
  HeartbeatRequest,
  PairWorkerRequest,
} from '@bitbucket-pr-approver/shared';
import type { ControlPlaneAuth } from '../services/control-plane-auth.js';
import type { WorkerAuth } from '../services/worker-auth.js';
import type { WorkerStore } from '../services/worker-store.js';
import type { WorkerLogStore } from '../services/worker-log-store.js';
import type { ExecutionDispatcher } from '../services/execution-dispatcher.js';
import type { EventHub } from '../services/events.js';
import type { StorageService } from '../services/storage.js';
import { ownerSessionId } from './session.js';

function requestIsSecure(request: FastifyRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const forwarded = request.headers['x-forwarded-proto'];
  return request.protocol === 'https' || forwarded === 'https';
}

function requireSecure(request: FastifyRequest): void {
  if (!requestIsSecure(request)) {
    throw Object.assign(new Error('HTTPS is required for pairing and worker traffic'), {
      code: 'HTTPS_REQUIRED',
      statusCode: 426,
    });
  }
}

function ownerContext(request: FastifyRequest, auth: ControlPlaneAuth, requireCsrf: boolean) {
  const session = auth.requireSession(ownerSessionId(request));
  if (requireCsrf) auth.requireCsrf(session, request.headers['x-csrf-token'] as string | undefined);
  return session;
}

function workerContext(request: FastifyRequest, workerAuth: WorkerAuth, workerId: string) {
  return workerAuth.authenticate(workerId, request.headers.authorization);
}

export async function registerWorkerRoutes(
  app: FastifyInstance,
  options: {
    auth: ControlPlaneAuth;
    workerAuth: WorkerAuth;
    workerStore: WorkerStore;
    workerLogs: WorkerLogStore;
    executionDispatcher: ExecutionDispatcher;
    events: EventHub;
    storage: StorageService;
  }
): Promise<void> {
  const {
    auth,
    workerAuth,
    workerStore,
    workerLogs,
    executionDispatcher,
    events,
    storage,
  } = options;

  app.post<{ Body: { controlPlaneUrl?: string } }>(
    '/api/workers/pairing-sessions',
    async (request, reply) => {
      try {
        requireSecure(request);
        const session = ownerContext(request, auth, true);
        const host = request.headers.host || '127.0.0.1:3100';
        const controlPlaneUrl =
          request.body?.controlPlaneUrl || `${request.protocol}://${host}`;
        const pairing = workerStore.createPairingSession(session.ownerId, controlPlaneUrl);
        return reply.status(201).send({ success: true, data: pairing });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'PAIRING_CREATE_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{ Body: PairWorkerRequest }>('/api/workers/pair', async (request, reply) => {
    try {
      requireSecure(request);
      const body = request.body;
      if (!body?.code || !body.publicKey || !body.metadata) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Pairing code, public key and metadata are required' },
        });
      }
      const result = workerStore.consumePairingSession(body.code, body.publicKey, body.metadata);
      return reply.status(201).send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        error: { code: error.code || 'PAIRING_FAILED', message: error.message },
      });
    }
  });

  app.get('/api/workers', async (request, reply) => {
    try {
      const session = ownerContext(request, auth, false);
      return reply.send({ success: true, data: workerStore.listWorkers(session.ownerId) });
    } catch (error: any) {
      return reply.status(error.statusCode || 401).send({
        success: false,
        error: { code: error.code || 'SESSION_REQUIRED', message: error.message },
      });
    }
  });

  app.post<{ Params: { workerId: string }; Body: HeartbeatRequest }>(
    '/api/workers/:workerId/heartbeat',
    async (request, reply) => {
      try {
        requireSecure(request);
        workerContext(request, workerAuth, request.params.workerId);
        const before = workerStore.getWorker(request.params.workerId);
        const worker = workerStore.recordHeartbeat(request.params.workerId, request.body);
        if (
          before?.state !== worker.state ||
          before?.activeExecutionId !== worker.activeExecutionId ||
          before?.queueDepth !== worker.queueDepth
        ) {
          events.broadcast('worker_status_changed', worker);
        }
        return reply.send({ success: true, data: worker });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'HEARTBEAT_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{ Params: { workerId: string } }>(
    '/api/workers/:workerId/revoke',
    async (request, reply) => {
      try {
        ownerContext(request, auth, true);
        const worker = workerStore.revokeWorker(request.params.workerId);
        if (!worker) {
          return reply.status(404).send({
            success: false,
            error: { code: 'WORKER_NOT_FOUND', message: 'Worker not found' },
          });
        }
        return reply.send({ success: true, data: worker });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'WORKER_REVOKE_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{
    Params: { workerId: string };
    Body: { ciphertext?: string };
  }>('/api/workers/:workerId/token-envelope', async (request, reply) => {
    try {
      ownerContext(request, auth, true);
      const worker = workerStore.getWorker(request.params.workerId);
      if (!worker || worker.revokedAt) {
        return reply.status(404).send({
          success: false,
          error: { code: 'WORKER_NOT_FOUND', message: 'Worker not found' },
        });
      }
      if (!request.body?.ciphertext) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Encrypted token ciphertext is required' },
        });
      }
      const now = new Date();
      const envelope: EncryptedTokenEnvelope = {
        id: crypto.randomUUID(),
        workerId: worker.id,
        algorithm: 'RSA-OAEP-256',
        ciphertext: request.body.ciphertext,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      };
      workerStore.saveTokenEnvelope(envelope);
      return reply.status(201).send({ success: true, data: envelope });
    } catch (error: any) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        error: { code: error.code || 'TOKEN_ENVELOPE_FAILED', message: error.message },
      });
    }
  });

  app.post<{ Params: { workerId: string } }>(
    '/api/workers/:workerId/migrate-local-token',
    async (request, reply) => {
      try {
        ownerContext(request, auth, true);
        const worker = workerStore.getWorker(request.params.workerId);
        const localConfig = storage.getConfig();
        if (!worker || worker.revokedAt) {
          return reply.status(404).send({
            success: false,
            error: { code: 'WORKER_NOT_FOUND', message: 'Worker not found' },
          });
        }
        if (!localConfig?.token) {
          return reply.status(409).send({
            success: false,
            error: { code: 'LOCAL_TOKEN_MISSING', message: 'No local encrypted token is available' },
          });
        }
        const publicKey = crypto.createPublicKey({ key: worker.publicKey, format: 'jwk' });
        const ciphertext = crypto
          .publicEncrypt(
            {
              key: publicKey,
              oaepHash: 'sha256',
              padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            },
            Buffer.from(localConfig.token, 'utf8')
          )
          .toString('base64url');
        const now = new Date();
        const envelope: EncryptedTokenEnvelope = {
          id: crypto.randomUUID(),
          workerId: worker.id,
          algorithm: 'RSA-OAEP-256',
          ciphertext,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        };
        workerStore.saveTokenEnvelope(envelope);
        return reply.status(201).send({
          success: true,
          data: { envelopeId: envelope.id, expiresAt: envelope.expiresAt },
        });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'TOKEN_MIGRATION_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{ Params: { workerId: string } }>(
    '/api/workers/:workerId/token-envelope/claim',
    async (request, reply) => {
      try {
        workerContext(request, workerAuth, request.params.workerId);
        const envelope = workerStore.claimTokenEnvelope(request.params.workerId);
        return reply.send({ success: true, data: envelope });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'TOKEN_CLAIM_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{ Params: { workerId: string; envelopeId: string } }>(
    '/api/workers/:workerId/token-envelope/:envelopeId/ack',
    async (request, reply) => {
      try {
        workerContext(request, workerAuth, request.params.workerId);
        const removed = workerStore.acknowledgeTokenEnvelope(
          request.params.workerId,
          request.params.envelopeId
        );
        return reply.send({ success: true, data: { removed } });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'TOKEN_ACK_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{ Params: { workerId: string } }>(
    '/api/workers/:workerId/claims',
    async (request, reply) => {
      try {
        const worker = workerContext(request, workerAuth, request.params.workerId);
        if (worker.state !== 'ONLINE') {
          return reply.status(409).send({
            success: false,
            error: { code: 'WORKER_NOT_ONLINE', message: 'Worker is not online' },
          });
        }
        const lease = executionDispatcher.claim(worker.id);
        return reply.send({ success: true, data: { lease, serverTime: new Date().toISOString() } });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'CLAIM_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{ Params: { workerId: string; executionId: string } }>(
    '/api/workers/:workerId/executions/:executionId/renew',
    async (request, reply) => {
      try {
        workerContext(request, workerAuth, request.params.workerId);
        const lease = executionDispatcher.renew(
          request.params.workerId,
          request.params.executionId
        );
        return reply.send({ success: true, data: lease });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'LEASE_RENEW_FAILED', message: error.message },
        });
      }
    }
  );

  app.post<{
    Params: { workerId: string; executionId: string };
    Body: import('@bitbucket-pr-approver/shared').LogBatchRequest;
  }>('/api/workers/:workerId/executions/:executionId/logs', async (request, reply) => {
    try {
      workerContext(request, workerAuth, request.params.workerId);
      const result = workerLogs.appendBatch(
        request.params.workerId,
        request.params.executionId,
        request.body.sequence,
        request.body.items
      );
      events.broadcast('worker_log_batch', {
        workerId: request.params.workerId,
        executionId: request.params.executionId,
        items: request.body.items,
      });
      return reply.send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        error: { code: error.code || 'LOG_BATCH_FAILED', message: error.message },
      });
    }
  });

  app.post<{
    Params: { workerId: string; executionId: string };
    Body: import('@bitbucket-pr-approver/shared').ExecutionResultSummary;
  }>('/api/workers/:workerId/executions/:executionId/complete', async (request, reply) => {
    try {
      workerContext(request, workerAuth, request.params.workerId);
      if (request.body.executionId !== request.params.executionId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'EXECUTION_ID_MISMATCH', message: 'Execution ID does not match route' },
        });
      }
      const lease = executionDispatcher.complete(request.params.workerId, request.body);
      return reply.send({ success: true, data: lease });
    } catch (error: any) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        error: { code: error.code || 'EXECUTION_COMPLETE_FAILED', message: error.message },
      });
    }
  });

  app.get('/api/worker-logs', async (request, reply) => {
    try {
      ownerContext(request, auth, false);
      const query = request.query as import('@bitbucket-pr-approver/shared').WorkerLogQuery;
      return reply.send({ success: true, data: workerLogs.query(query) });
    } catch (error: any) {
      return reply.status(error.statusCode || 400).send({
        success: false,
        error: { code: error.code || 'WORKER_LOG_QUERY_FAILED', message: error.message },
      });
    }
  });

  app.get<{ Params: { workerId: string } }>(
    '/api/workers/:workerId/update-manifest',
    async (request, reply) => {
      try {
        workerContext(request, workerAuth, request.params.workerId);
        const version = process.env.WORKER_UPDATE_VERSION;
        const bundleUrl = process.env.WORKER_UPDATE_BUNDLE_URL;
        const sha256 = process.env.WORKER_UPDATE_SHA256;
        const signature = process.env.WORKER_UPDATE_SIGNATURE;
        const available = Boolean(version && bundleUrl && sha256 && signature);
        return reply.send({
          success: true,
          data: {
            available,
            version: version || null,
            bundleUrl: bundleUrl || null,
            sha256: sha256 || null,
            signature: signature || null,
            minimumProtocol: 1,
          },
        });
      } catch (error: any) {
        return reply.status(error.statusCode || 400).send({
          success: false,
          error: { code: error.code || 'UPDATE_MANIFEST_FAILED', message: error.message },
        });
      }
    }
  );
}
