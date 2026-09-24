import type { FastifyInstance } from 'fastify';
import type { EventHub } from '../services/events.js';
import type { SchedulerService } from '../services/scheduler.js';

export async function registerSseRoutes(
  app: FastifyInstance,
  options: { events: EventHub; scheduler: SchedulerService }
): Promise<void> {
  const { events, scheduler } = options;

  app.get('/api/events', async (_req, reply) => {
    // Hijack the raw Node.js ServerResponse for streaming SSE
    reply.hijack();
    const initialStatus = scheduler.getStatus();
    events.registerClient(reply.raw, {
      type: 'status_changed',
      timestamp: new Date().toISOString(),
      data: initialStatus,
    });
  });
}
