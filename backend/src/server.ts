import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { StorageService } from './services/storage.js';
import { EventHub } from './services/events.js';
import { SchedulerService } from './services/scheduler.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerLogsRoutes } from './routes/logs.js';
import { registerPreviewRoutes } from './routes/preview.js';
import { registerSseRoutes } from './routes/sse.js';
import { registerBitbucketMetadataRoutes } from './routes/bitbucket.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerWorkerRoutes } from './routes/workers.js';
import { ControlPlaneAuth } from './services/control-plane-auth.js';
import { WorkerAuth } from './services/worker-auth.js';
import { WorkerLogStore } from './services/worker-log-store.js';
import { WorkerStore } from './services/worker-store.js';
import { ExecutionDispatcher } from './services/execution-dispatcher.js';
import { registerWorkerInstallerRoutes } from './routes/worker-installer.js';
import { ownerSessionId } from './routes/session.js';

export interface ServerInstance {
  app: FastifyInstance;
  storage: StorageService;
  scheduler: SchedulerService;
  events: EventHub;
  workerStore: WorkerStore;
  workerLogs: WorkerLogStore;
  executionDispatcher: ExecutionDispatcher;
}

export interface BuildServerOptions {
  dataDir?: string;
  disableScheduler?: boolean;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<ServerInstance> {
  const configuredOrigin = process.env.CONTROL_PLANE_ORIGIN;
  if (process.env.NODE_ENV === 'production' && !configuredOrigin) {
    throw new Error('CONTROL_PLANE_ORIGIN is required in production');
  }
  const allowedOrigins = new Set(
    [
      configuredOrigin,
      'http://localhost:3100',
      'http://127.0.0.1:3100',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter((origin): origin is string => Boolean(origin))
  );
  const app = Fastify({
    logger: false, // Lean & fast, keep console clean
  });

  // 1. Register CORS for API requests only. Static frontend files are served
  // from the same origin and must remain reachable when the control plane is
  // accessed through a temporary IP address before its public domain is live.
  await app.register(cors, {
    delegator: (request, callback) => {
      if (!request.url.startsWith('/api/')) {
        callback(null, { origin: false });
        return;
      }

      callback(null, {
        origin: (origin, originCallback) => {
          if (!origin || allowedOrigins.has(origin)) return originCallback(null, true);
          return originCallback(
            Object.assign(new Error('Origin is not allowed'), {
              code: 'CORS_ORIGIN_DENIED',
              statusCode: 403,
            }),
            false
          );
        },
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        credentials: true,
      });
    },
  });
  await app.register(fastifyCookie);

  // 2. Initialize Services
  const storage = new StorageService(options.dataDir);
  const events = new EventHub();
  const workerStore = new WorkerStore(storage.getDataDir());
  const workerLogs = new WorkerLogStore(storage.getDataDir());
  const executionDispatcher = new ExecutionDispatcher(storage, workerStore, events);
  const scheduler = new SchedulerService(storage, events, executionDispatcher);
  const controlPlaneAuth = new ControlPlaneAuth(storage.getDataDir());
  const workerAuth = new WorkerAuth(workerStore);

  app.addHook('preHandler', async (request) => {
    if (!controlPlaneAuth.enabled || !request.url.startsWith('/api/')) return;
    if (
      request.url === '/api/health' ||
      request.url.startsWith('/api/session') ||
      request.url.startsWith('/api/workers/') ||
      request.url === '/api/workers'
    ) {
      return;
    }
    const session = controlPlaneAuth.requireSession(ownerSessionId(request));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      controlPlaneAuth.requireCsrf(
        session,
        request.headers['x-csrf-token'] as string | undefined
      );
    }
  });

  if (!options.disableScheduler) {
    scheduler.start();
  }

  // 3. Register REST API Routes
  await registerHealthRoutes(app, { scheduler });
  await registerConfigRoutes(app, { storage });
  await registerJobRoutes(app, {
    storage,
    scheduler,
    executionDispatcher,
    workerStore,
  });
  await registerLogsRoutes(app, { storage });
  await registerPreviewRoutes(app, { storage });
  await registerSseRoutes(app, { events, scheduler });
  await registerBitbucketMetadataRoutes(app, { storage });
  await registerSessionRoutes(app, { auth: controlPlaneAuth });
  await registerWorkerRoutes(app, {
    auth: controlPlaneAuth,
    workerAuth,
    workerStore,
    workerLogs,
    executionDispatcher,
    events,
    storage,
  });
  await registerWorkerInstallerRoutes(app, { auth: controlPlaneAuth });

  // 4. Register Frontend Static Files (if production build exists)
  const possibleFrontendDirs = [
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), 'dist/public'),
    path.resolve(process.cwd(), 'public'),
  ];

  let frontendDist: string | null = null;
  for (const dir of possibleFrontendDirs) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
      frontendDist = dir;
      break;
    }
  }

  if (frontendDist) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
    });

    // SPA fallback: redirect any non-api route to index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.url} not found`,
          },
        });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Endpoint ${req.method} ${req.url} not found`,
        },
      });
    });
  }

  // 5. Global Error Handler
  app.setErrorHandler((error: any, _req, reply) => {
    const statusCode = error?.statusCode || 500;
    return reply.status(statusCode).send({
      success: false,
      error: {
        code: error?.code || 'INTERNAL_SERVER_ERROR',
        message: error?.message || 'Unknown server error',
      },
    });
  });

  return {
    app,
    storage,
    scheduler,
    events,
    workerStore,
    workerLogs,
    executionDispatcher,
  };
}
