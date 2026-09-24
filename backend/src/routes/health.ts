import type { FastifyInstance } from 'fastify';
import type { SchedulerService } from '../services/scheduler.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  options: { scheduler: SchedulerService }
): Promise<void> {
  const { scheduler } = options;

  app.get('/api/health', async (_req, reply) => {
    const status = scheduler.getStatus();
    return reply.send({
      success: true,
      data: {
        status: 'OK',
        uptimeSeconds: status.uptimeSeconds,
        vpnConnected: status.vpnConnected,
        serverTime: new Date().toISOString(),
      },
    });
  });

  app.get('/api/status', async (_req, reply) => {
    const status = scheduler.getStatus();
    return reply.send({
      success: true,
      data: status,
    });
  });
}
