import { APP_CONSTANTS } from '@bitbucket-pr-approver/shared';
import { buildServer } from './server.js';

async function bootstrap(): Promise<void> {
  const port = parseInt(process.env.PORT || String(APP_CONSTANTS.DEFAULT_PORT), 10);
  const host = process.env.HOST || APP_CONSTANTS.DEFAULT_HOST;

  const { app, storage, scheduler, events } = await buildServer();

  try {
    await app.listen({ port, host });
    console.log(`\n========================================================`);
    console.log(`🚀 ${APP_CONSTANTS.APP_NAME} v${APP_CONSTANTS.APP_VERSION}`);
    console.log(`📡 Server:   http://${host}:${port}`);
    console.log(`🔐 Storage:  ${storage.getDataDir()} (AES-256-GCM)`);
    console.log(`🛡️  Network:  Loopback isolated (Inherits Corporate VPN)`);
    console.log(`========================================================\n`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    scheduler.stop();
    events.close();
    await app.close();
    console.log('Server stopped.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Bootstrap error:', err);
  process.exit(1);
});
